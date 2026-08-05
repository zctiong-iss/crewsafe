# ADR 0010 — SonarQube Cloud as the SAST provider

**Status:** Proposed
**Date:** 2026-08-04
**Jira:** SCRUM-178
**Author:** Zhong Cheng Tiong

## Why this ADR exists

`AGENTS.md` §8 forbids adding stack components outside the project plan §10.3 without an
ADR. SonarQube Cloud is not in §10.3, and it is not merely a local dev tool: it is an
**external service that receives this repository's source code**. That makes it a data
boundary change, not a tooling preference, so it needs a recorded decision rather than a
line in a workflow file.

## Context

SCRUM-178 requires static application security testing that:

- covers backend Java/Spring today and frontend TypeScript later (FR-003, FR-004);
- fails the build at an agreed severity rather than only warning (FR-006);
- shows findings on the pull request, not only in workflow logs (FR-008);
- fails closed when the scanner cannot run (FR-012).

Two environmental facts constrain the choice, both verified 2026-08-04:

1. **`zctiong-iss/crewsafe` is a private repository without GitHub Advanced Security.**
   `gh api repos/zctiong-iss/crewsafe/code-scanning/alerts` returns HTTP 403, "Code scanning
   is not enabled". This rules out CodeQL and any SARIF-upload reporting path.
2. **`backend/pom.xml` has no JaCoCo plugin**, so no coverage data exists to gate on.

## Decision

Use **SonarQube Cloud on the free plan** as the SAST provider, with its Quality Gate as a
blocking status check, analysed from CI via `sonar-maven-plugin`.

Secret scanning is **not** part of this decision: SonarQube does not scan git history, and
FR-002/FR-002a require exactly that. gitleaks remains the secret scanner. The two tools
cover different requirements and neither replaces the other.

### What this means concretely

| Aspect | Decision |
|---|---|
| Plan | Free — private projects up to 50,000 LOC |
| Severity gate | `Blocker` + `High` block; `Medium`/`Low`/`Info` report only — **intended design; not currently achievable, see Addendum below** |
| Quality Gate | Custom, security and reliability conditions only — **no coverage condition** — **intended design; not currently achievable, see Addendum below** |
| Blocking mechanism | `sonar.qualitygate.wait=true` with a bounded `sonar.qualitygate.timeout` |
| Reporting | Sonar's native pull-request decoration |
| Credential | `SONAR_TOKEN` as a repository secret |

> **This table describes the intended design, not the current running state.** See the
> 2026-08-04 addendum for what the free plan actually permits and what was decided instead.

## Data boundary — what leaves the repository

This is the part that makes an ADR necessary rather than optional.

| Question | Answer |
|---|---|
| What is transmitted? | Repository source under the configured `sonar.sources` — today `backend/`. Also file paths, git blame metadata (author, commit, date), and branch/PR identifiers. |
| What is **not** transmitted? | Repository secrets, `.env` files, Terraform state, and CI logs. Analysis reads the checked-out tree and compiled bytecode only. |
| To whom? | SonarSource (SonarQube Cloud), under the account owned by the repository owner. |
| Retained where? | In the SonarQube Cloud project, until the project is deleted. |
| Does this include PII or credentials? | It should not. If a credential is present in source, that is itself a defect the gitleaks gate is designed to catch — which is a further reason the secret gate runs on every pull request regardless of path. |

The project handles worker health and location data (see plan §11), but **none of it is
transmitted here**: this is source code analysis, not runtime data. No production database,
no runtime records, no user data leaves the repository.

## Consequences

### Accepted costs

- **A third party now sits in the merge path.** A SonarQube Cloud outage blocks merges.
  This is correct fail-closed behaviour (FR-012) but it is a real availability coupling that
  a local binary would not have introduced. Bounded by `sonar.qualitygate.timeout`; the
  runbook makes re-running the job the first response.
- **Fork pull requests cannot run SAST.** GitHub withholds secrets from fork-triggered
  workflows, so `SONAR_TOKEN` is absent and the check fails (FR-008a). Acceptable because
  the project accepts no fork contributions. **`pull_request_target` MUST NOT** be used to
  work around this — it would expose secrets to untrusted head code.
- **Weaker automated regression protection for SAST.** Sonar's analyser is behind an
  authenticated SaaS and cannot be exercised hermetically in a throwaway directory. The
  automated test reduces to a configuration lint (chiefly: is `sonar.qualitygate.wait` set,
  since without it the step exits 0 regardless of the gate result). The behavioural
  assertion — a real `High` finding blocks a pull request — is demonstrated once as
  reviewer evidence. The secret gate keeps full hermetic test coverage; this asymmetry is
  a direct cost of the SaaS choice and is recorded rather than hidden.
- **A quota now exists.** 50,000 LOC on the free plan; measured usage at decision time was
  ~8,700 lines of Java across 110 files, about 17%. `web/`, `mobile/`, and `ml-service/`
  will consume more.
- **Adding a new source tree needs a config edit.** `sonar.sources` must be updated when
  frontend code lands — a small regression against FR-004's "no pipeline edit" intent.

### Benefits

- Severity maps natively: Sonar's MQR scale is `Blocker/High/Medium/Low/Info`, so FR-006's
  "HIGH and above" needs no translation table that a future maintainer could misread.
- Pull-request decoration is included on the free plan, satisfying FR-008 with no
  entitlement and no annotation renderer of our own.
- One engine covers Java and TypeScript/JavaScript, so US3 holds without a second tool.
- A quality dashboard the project did not previously have.

## Constraints on future changes

- **No required check may depend on a paid or trial capability** (FR-019). A 14-day trial
  may be started for evaluation, but trial features stay additive and advisory. Making a
  trial capability blocking is a new decision requiring its own review — not a settings
  tweak — because a lapsed trial would otherwise either break every merge or silently
  weaken the gate. A silently weakened gate is worse than an absent one: it still reports
  green.
- **Quota headroom must be checked before it bites** (FR-020), specifically when `web/` or
  `mobile/` gain real source.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| **Semgrep OSS CLI** | Technically strong: local binary, no vendor in the merge path, trivially fail-closed, works on fork PRs, and fully testable in a throwaway directory. Rejected in favour of Sonar's native PR decoration, native HIGH severity, and quality dashboard on the free plan. **This remains the documented fallback** if the free plan stops fitting. |
| SonarQube Community Build (self-hosted) | Pull-request analysis and decoration begin at Developer Edition (~$2,500/yr); Community Build has neither, so it fails FR-008. The unofficial `sonarqube-community-branch-plugin` adds them but is unmaintained by SonarSource with no supported upgrade path — unacceptable inside a security gate. Also requires hosting a server and database. |
| CodeQL | Free only for public repositories; needs GHAS on private (verified unavailable). |
| SpotBugs + FindSecBugs | Java-only. `web/` and `mobile/` would need a second tool, defeating FR-004/US3. Remains a good future complement for Java-specific depth. |
| Trivy filesystem scan | Already present for Terraform config scanning, but it is a misconfiguration and dependency scanner, not an application SAST engine. |

## Reversal path

If the free plan ceases to fit — a LOC overrun, a pricing change, or an unacceptable outage
record — revert to Semgrep OSS. The exit-code contract in the SCRUM-178 design was written
provider-neutral (`0` clean, `1` findings, `2` scanner error) specifically so this swap
touches the SAST job and its config lint, not the workflow structure, the secret gate, or
the tests.

## Addendum, 2026-08-04 — the free plan does not allow a custom Quality Gate

Discovered when setting up the SonarQube Cloud project (manual setup step 2): the project's
Quality Gate page states plainly, *"Your current plan does not allow you to associate a
quality gate other than Sonar way (Default) to this project."* Custom Quality Gates —
which the Decision above assumes — require a paid plan. This was not caught during
research; the free-plan documentation describes LOC limits and PR decoration but does not
foreground this restriction.

**Consequence**: the project runs on the built-in **"Sonar way"** gate, not the
security-only gate described above. Sonar way's New Code conditions include coverage
(≥ 80%), duplicated lines (≤ 3%), and a maintainability rating, in addition to security and
reliability ratings. `backend/pom.xml` has no JaCoCo plugin (28 test files against 82 main
classes, so coverage would not clear 80% even if wired up), so **the coverage condition
would fail on effectively every real pull request** — exactly the "gate blocks for a reason
unrelated to security" failure mode this ADR's Decision was written to avoid.

A UI-level exemption exists — "ignore duplication and coverage on small changes," which
skips those two conditions for changesets under 20 new lines — but it does not help most
real pull requests, and it does nothing for the maintainability-rating condition.

**Decision (interim)**: keep `sonar.qualitygate.wait=true` against the default Sonar way
gate as currently implemented, and **do not add `Secret Scan` / `SAST (SonarQube)` /
`Gate Self-Tests` to the required status checks on `main`** (manual setup step 3) until
this is resolved. The `SAST (SonarQube)` check will report its true result — likely
failing on coverage for any substantive change — but since no check is required yet, this
does not block merges. This was the user's explicit choice, made with the trade-off above
in view, in preference to either scope-creeping this issue with a JaCoCo rollout or shipping
a gate that blocks on the wrong grounds.

**Planned resolution**: a 14-day SonarQube Cloud trial will be started within the next few
days, which should unlock custom Quality Gates. At that point, create the security-only
gate as originally designed (see
[manual setup step 2](../runbooks/SCRUM-178-manual-setup.md#step-2--custom-quality-gate-security-conditions-only)),
assign it to the project, and only then proceed to step 3 (required checks). Per FR-019,
this trial capability must not become the *permanent* basis for a required check without a
deliberate follow-up decision — if the trial lapses before a subscription decision is made,
the project reverts to Sonar way and this addendum's constraint applies again.

## Addendum, 2026-08-06 — the Maven-plugin mechanism silently under-scanned the repo

The Decision above originally specified analysis "via `sonar-maven-plugin`", invoked as
`org.sonarsource.scanner.maven:sonar-maven-plugin:sonar` bound to `backend/pom.xml`. This
failed in CI in two stages, and the second failure was the more serious of the two because
it did not fail loudly.

**First**: the plugin does not read `sonar-project.properties` at all — that file format is
a `sonar-scanner`-CLI convention, and the Maven plugin ignores it entirely. CI failed
immediately with *"You must define the following mandatory properties for
'com.crewsafe:crewsafe-backend': sonar.organization"*, because every property in that file,
including `sonar.organization`, was invisible to the step.

**Second**, after a workaround that manually parsed the properties file in bash and passed
each value as a Maven `-D` flag: analysis ran and reported a passing gate, but it was
silently analysing less than it claimed. The Sonar Maven plugin resolves `sonar.sources`
relative to the *invoked module's own basedir* — here, `backend/` — and is documented to
skip source paths outside it, even with `sonar.projectBaseDir` explicitly set to the repo
root. This is a known upstream limitation for non-multi-module Maven projects (see
[Sonar Community: "sonar.projectBaseDir doesn't work with non-multi-module projects"](https://community.sonarsource.com/t/sonar-projectbasedir-doesnt-work-with-non-multi-module-projects/321)).
Concretely, `web/` and `mobile/` were never analysed, despite `sonar.sources` naming them,
and despite the check reporting green — exactly the "passing gate that quietly analyses
less than it claims to" failure mode Principle II exists to prevent.

**Resolution**: replaced the Maven-plugin invocation with the official
`SonarSource/sonarqube-scan-action` (the standalone `sonar-scanner` CLI, pinned by commit
SHA per this repo's convention). It has no Maven module-scoping concept and reads
`sonar-project.properties` natively from the repository root — which is what that file
format was designed for, and what this ADR's own Decision table already assumed before the
implementation quietly diverged from it. Maven is still used, but only to `compile` the
backend module so the Java analyzer has bytecode to read (`sonar.java.binaries`); no Sonar
plugin runs as part of that step.

`.github/scripts/tests/test-sast-gate-config.sh` now asserts the workflow uses the scan
action and does not reference the Maven plugin, so this class of regression cannot recur
silently a second time.

## References

- `docs/runbooks/SCRUM-178-sast-and-secret-scanning.md` — operating the gates
- `docs/plans/SCRUM-178-sast-and-secret-scanning-plan.md`
- [SonarQube software qualities and severities](https://docs.sonarsource.com/sonarqube-server/quality-standards-administration/managing-rules/software-qualities)
- [SonarQube Cloud subscription plans](https://docs.sonarsource.com/sonarqube-cloud/administering-sonarcloud/managing-subscription/subscription-plans)
- [Pull request analysis edition availability](https://docs.sonarsource.com/sonarqube-server/10.8/analyzing-source-code/pull-request-analysis/setting-up-the-pull-request-analysis)
