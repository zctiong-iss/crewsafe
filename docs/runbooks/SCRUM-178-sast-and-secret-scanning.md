# SCRUM-178 — SAST and secret-scanning gates

Operating guide for the two security gates in `.github/workflows/security-scan.yml`.
Tool choice and its trade-offs are recorded in
[ADR 0010](../adr/0010-sonarqube-cloud-for-sast.md).

## What runs, and when

| Check | Tool | Blocks on | Triggers |
|---|---|---|---|
| `Secret Scan` | gitleaks 8.30.1 (pinned, checksum-verified) | any secret finding | PR, daily, manual |
| `SAST (SonarQube)` | SonarQube Cloud, free plan | Quality Gate fail (`Blocker`/`High` in new code) | PR, manual |
| `Gate Self-Tests` | shell | any gate test failing | PR, daily, manual |

The workflow has **no `paths:` filter**, deliberately. A secret can be committed
anywhere. Before this change the only gitleaks run lived inside the path-filtered
Terraform workflow, so a `backend/`-only pull request received no secret scan at all.

**No push-to-`main` trigger.** Removed 2026-08-07: pull-request coverage plus the daily
full-history sweep below was judged sufficient, and it avoids paying for a scan (SAST
quota included) on every merge commit. `Secret Scan` and `Gate Self-Tests` still run daily
regardless; `SAST (SonarQube)` runs only on a pull request or a manual dispatch.

**Secret scan scope** differs by trigger: a pull request scans its own commit range
(merge-base → HEAD), while the daily schedule scans the full history. A secret added and
then deleted within a branch is still caught — deleting it from the tip does not remove it
from history.

## Reading a result

Both surfaces are on the pull request, no log-opening required:

- **Secret findings** — inline annotations on the offending line, plus a job summary table
  (rule, file, line, severity).
- **SAST findings** — SonarQube's own pull-request decoration.

The summary always distinguishes three states, and this matters: **"ran and found
nothing" is worded differently from "did not run"**. A failing check tells you which of
the two it was — findings, or the scanner being unable to run.

Detected secret values are never printed. The raw gitleaks report contains the credential
in its `Secret` and `Match` fields; `scan-secrets.sh` projects only rule, file, line, and
commit, and deletes the raw report on exit.

## A secret was found — what to do

**Rotate the credential at its source first.** Removing a secret from git does not make an
exposed secret safe. Anyone with repository access, and anything that mirrored or cached
the repository, may already have it.

1. **Rotate** the credential in AWS / Cognito / the database / wherever it lives.
2. **Remove** it from the code and replace with a Secrets Manager reference or a GitHub
   secret.
3. **Push** the fix. The gate re-runs automatically and clears on the corrected commit.
4. Only if it is genuinely **not** a credential, add an allowlist entry (below).

Do not skip step 1 because the commit "was not pushed to main" or "the file was deleted".
History scanning exists precisely because deletion is not removal.

## Adding an allowlist entry (false positives only)

Edit `.gitleaks.toml`. Every entry needs:

- a `description` saying why the match is not a real credential;
- the narrowest possible scope.

**Prefer `commits = [...]` over `paths = [...]`.** Commits are immutable, so a
commit-scoped entry exempts exactly the historical match and nothing else. A path-scoped
entry would blind the gate to a *future* real secret in that file — verified 2026-08-04:
with the baseline commits allowlisted, a newly committed secret in the same file is still
detected and still blocks.

Never exclude a whole directory. Excluding `.github/cognito/**` would blind the gate in
exactly the area that handles identity credentials.

Never add an entry to accommodate a test fixture. The gate's tests generate synthetic
credentials at runtime inside throwaway repositories, so nothing secret-shaped is
committed and nothing needs allowlisting.

## Severity mapping

SonarQube's MQR severities map to the agreed threshold as follows. Sonar never prints the
word "HIGH" in the sense the spec uses it, so this table is the connection:

| Spec term | SonarQube severity | Effect |
|---|---|---|
| HIGH and above | `Blocker`, `High` | **blocks the merge** |
| MEDIUM | `Medium` | reported, does not block |
| LOW | `Low`, `Info` | reported, does not block |

Every secret finding blocks regardless of severity — secret detection has no warn-only tier.

## Suppressing a SonarQube issue

**Prefer `// NOSONAR` with the rule id and a reason in an adjacent comment.** It appears in
the diff, so a reviewer sees it.

A "Won't Fix" / "False Positive" resolution in the Sonar UI is attributable but lives in
Sonar's database, **not in a reviewable git diff** — invisible in code review, and lost if
the project is ever recreated. If you resolve a `Blocker` or `High` issue that way, say so
in the pull request discussion so a human sees the decision.

## The Quality Gate has no coverage condition — on purpose

`backend/pom.xml` has no JaCoCo plugin, so there is no coverage data. Sonar's stock
"Sonar way" gate includes a coverage-on-new-code condition, which would report 0% and
block **every** merge for a reason unrelated to security.

If you add JaCoCo later and want coverage gating, add the plugin first, confirm reports are
produced, then add the condition — and update the assertion in
`.github/scripts/tests/test-sast-gate-config.sh` that currently guards against exactly this
misconfiguration.

## Adding a new source tree (web/, mobile/, ml-service/)

Append the path to `sonar.sources` in `sonar-project.properties`, and check free-plan
line-of-code headroom at the same time (see quota below). This is a manual step: unlike the
secret gate, which needs no per-tree configuration, Sonar will not analyse a tree it has
not been told about, and it will not warn you that it skipped one.

## Free-plan quota

50,000 lines of code for private projects. Measured 2026-08-04: ~8,700 lines of Java across
110 files, roughly 17%. Read current usage in the SonarQube Cloud project's administration
page. **Check headroom when `web/` or `mobile/` gain real source**, rather than discovering
the ceiling through a failed gate.

## Trial policy

A 14-day trial of paid features may be started for evaluation. While it runs, trial
features stay **additive and advisory**.

**No required check may depend on a trial or paid capability.** If a trial lapses and a
gate depended on it, the gate either breaks every merge or silently weakens — and a
silently weakened security gate is worse than an absent one, because it still reports
green. Making a trial capability blocking is a new decision requiring its own review.

## Troubleshooting

| Symptom | Cause | Action |
|---|---|---|
| Check fails, summary says "infrastructure failure" | Scanner could not run — download, network, or auth | Re-run the job first. Persistent → check the pinned version and the Sonar service status. |
| `SAST` fails on a fork pull request | `SONAR_TOKEN` is unavailable to forks by design | Expected. Recreate the branch inside this repository. `pull_request_target` must not be used to work around this. |
| Sonar reports "not authorized" | Token expired or revoked | Rotate `SONAR_TOKEN`. The gate fails closed meanwhile, which is correct. |
| Secret scan exits 2 on a PR | Merge-base unresolvable, usually a shallow clone | Confirm `fetch-depth: 0` on checkout. |
| SAST green suspiciously fast | `sonar.qualitygate.wait` missing — step exits 0 without waiting for the gate | `Gate Self-Tests` asserts this; check that job ran. |
| Daily sweep stopped appearing | GitHub disables scheduled workflows after 60 days of repository inactivity | Re-enable in the Actions tab. **A quiet period is not a clean sweep.** |

## Running the gates locally

```sh
.github/scripts/security/install-scanners.sh ~/bin   # or any dir on PATH

.github/scripts/security/scan-secrets.sh --mode full
.github/scripts/security/scan-secrets.sh --mode range --base origin/main

.github/scripts/tests/test-secret-scan-gate.sh
.github/scripts/tests/test-report-findings.sh
.github/scripts/tests/test-sast-gate-config.sh
```

Exit codes: `0` clean, `1` findings, `2` scanner could not run. SAST is not runnable
locally — it needs `SONAR_TOKEN` and runs in CI.

## One-time setup

Creating the SonarQube project, the Quality Gate, and the required status checks are manual
steps. They are written up separately, step by step, in
[SCRUM-178 — one-time manual setup](./SCRUM-178-manual-setup.md).

Until the required-checks step is done, `main` has branch protection with **zero required
status checks**, so these gates run and block nothing — FR-011 is unmet and SCRUM-178 is
not Done.
