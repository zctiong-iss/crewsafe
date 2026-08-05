# SCRUM-178 — CI SAST and secret-scanning gates

**Jira**: SCRUM-178 (subtask of SCRUM-143, US-22)
**Branch**: `feat/scrum-178-sast-and-secret-scanning`
**Status**: Implemented, pending the manual setup steps below

Durable record of the approved plan. Day-to-day operation lives in
[the runbook](../runbooks/SCRUM-178-sast-and-secret-scanning.md); the provider decision and
its trade-offs live in [ADR 0010](../adr/0010-sonarqube-cloud-for-sast.md).

## Problem

The repository had no secret scanning on most changes and no static analysis at all.

The only gitleaks run lived inside `terraform-validate.yml`, which is path-filtered to
Terraform and Cognito paths. **A pull request touching only `backend/` was never scanned.**
That mattered because SCRUM-154 and SCRUM-174 handle Cognito and database credentials, and
the repository already carried Cognito testing documentation.

## What was built

| Component | Purpose |
|---|---|
| `.github/workflows/security-scan.yml` | Three checks: `Secret Scan`, `SAST (SonarQube)`, `Gate Self-Tests`. No path filter. |
| `.github/scripts/security/install-scanners.sh` | Pinned gitleaks 8.30.1, SHA-256 verified before execution |
| `.github/scripts/security/scan-secrets.sh` | Commit-range scan on PRs, full history on a daily schedule |
| `.github/scripts/security/report-findings.sh` | Annotations + job summary; the only script that reads a raw report |
| `.github/scripts/tests/` | 39 tests: 12 secret gate, 12 reporter, 15 config lint |
| `.gitleaks.toml` | Allowlist with the baseline-sweep entries |
| `sonar-project.properties` | Sonar project identity, sources, exclusions |

### Key design decisions

**Gate logic lives in shell scripts; the workflow is a thin caller.** This is what makes
"a planted secret fails the pipeline" an automated regression test rather than a one-time
demonstration. Inline `run:` blocks could only be tested by pushing to CI and watching.

**Exit codes `0` / `1` / `2` — clean, findings, scanner-could-not-run.** Both `1` and `2`
fail the check, but the summary distinguishes them. A green check must never mean "the
scanner did not run".

**Redaction is structural.** The raw gitleaks report contains the credential in its
`Secret` and `Match` fields. Exactly one script reads that report, and it projects only
rule, file, line, and commit. A test asserts no substring of a planted credential reaches
any output.

**Secret scanning covers the PR's commit range, not just the tip.** A credential added in
one commit and deleted in a later one is still caught.

## Verification

All 39 gate tests pass locally. Beyond the planned cases, implementation surfaced several
things worth recording, because each was a real defect caught by testing rather than by
inspection:

| Finding | Resolution |
|---|---|
| AWS `AKIA` keys are an unreliable test fixture — gitleaks gates on Shannon entropy, so only 2 of 20 random keys were detected; AWS's documented `AKIAIOSFODNN7EXAMPLE` is allowlisted upstream and never detected | Switched the synthetic credential to a Stripe test-mode shape: 12 of 12 detected, no entropy gate |
| A missing script exits 1, so every `assert_exit 1` would have passed against a script that did not exist | Added `require_executable`, which hard-fails the suite |
| `jq`'s `.blocking // true` returns `true` for an explicit `false` — advisory findings rendered as blocking errors | Compare explicitly with `.blocking == false` |
| The job-summary table printed `file` unsanitized, so a crafted path could break the table or emit a workflow command | Sanitize in the summary as well as the annotations |
| `${{ github.base_ref }}` was interpolated directly into a `run:` block — a shell-injection vector, in a security gate | Passed through an intermediate `env:` var. Caught by semgrep during implementation. |

### Baseline history sweep (FR-017)

Swept 253 commits before enabling the gates. **5 findings, all false positives**, all in
documentation authored 2026-07-29 and since deleted from `main`:

- `backend/COGNITO_SETUP_GUIDE.md` — two truncated JWT examples (`eyJ...`)
- `TESTING_REPORT.md` — literal `Bearer invalid-token` in a 401-response example
- `COGNITO_LOCAL_TESTING.md` — literal `Bearer COGNITO_TOKEN` placeholder
- `BACKEND_IMPLEMENTATION_ROADMAP.md` — an example idempotency key

**No real credential was exposed, so no rotation was required.**

They are allowlisted **by commit, not by path**. Commits are immutable, so the exemption
covers exactly those historical matches. Verified empirically: with the baseline commits
allowlisted, a newly committed secret in the same file is still detected and still blocks.
A path-scoped entry would have blinded the gate to future leaks in files that discuss
identity credentials.

## Known limitations

**SAST regression protection is weaker than the secret gate's.** SonarQube's analyser is
behind an authenticated SaaS and cannot be exercised hermetically, so the automated test is
a *configuration lint* — chiefly asserting `sonar.qualitygate.wait=true` is present, since
without it the analysis step exits 0 regardless of the Quality Gate result. The behavioural
assertion is one-time reviewer evidence. This is a direct cost of choosing a SaaS analyser
and is recorded rather than hidden.

**Fork pull requests cannot run SAST**, because `SONAR_TOKEN` is withheld from them. The
check fails rather than skips. `pull_request_target` is deliberately not used.

**The Quality Gate carries no coverage condition**, because `backend/pom.xml` has no JaCoCo
plugin and the stock gate would block every merge at 0% coverage for a non-security reason.

**Adding a new source tree needs a `sonar.sources` edit**, unlike the secret gate.

## Post-implementation changes

**2026-08-06 — SAST scope.** The original design ran analysis via `sonar-maven-plugin`
bound to `backend/pom.xml`. That plugin resolves `sonar.sources` relative to the invoked
module's own basedir and is documented to silently skip paths outside it, even with
`sonar.projectBaseDir` set — a known upstream limitation for non-multi-module Maven
projects. `web/` and `mobile/` were never actually analysed despite being declared and
despite the check reporting green. Replaced with the official
`SonarSource/sonarqube-scan-action` (the standalone `sonar-scanner` CLI, pinned by commit
SHA), which has no Maven module-scoping concept and reads `sonar-project.properties`
natively. Full account in
[ADR 0010's 2026-08-06 addendum](../adr/0010-sonarqube-cloud-for-sast.md).

**2026-08-07 — triggers.** Moved the full-history secret sweep from weekly to daily. The
`push`-to-`main` trigger was removed the same day, then **restored a few hours later**
once its second purpose became clear: `push` is the only thing that refreshes
SonarQube's own `main` branch snapshot (the Code tab / dashboard view — separate from
each PR's own analysis, which is unaffected either way). With `push` gone and `SAST`
already excluding `schedule` runs by design, `main`'s snapshot had no trigger left at
all, and was found stuck showing a stale, backend-only analysis from *before* the
`sonar-maven-plugin` → scan-action fix above — the exact under-scanning bug this branch
exists to fix, just frozen in place on `main` instead of live. `push` stays; the daily
sweep stays too, as an independent backstop for anything that lands outside a normal
pull request.

## Remaining manual steps

These cannot be done from code and are **not** complete. Step-by-step instructions:
[SCRUM-178 — one-time manual setup](../runbooks/SCRUM-178-manual-setup.md).

1. Create the SonarQube Cloud organization and `crewsafe` project (free plan), install the
   Sonar GitHub App, add `SONAR_TOKEN` as a repository secret.
2. Create the custom Quality Gate — security and reliability conditions only, no coverage
   condition — and assign it to the project.
3. After merge and one reported run, add `Secret Scan`, `SAST (SonarQube)`, and
   `Gate Self-Tests` to the required status checks on `main`.
4. Demonstrate a real `High` finding blocking a scratch pull request; record as evidence.

**Until step 3 the gates run but block nothing**, and FR-011 is unmet. `main` currently has
branch protection with zero required status checks.

## Constitution compliance

| Principle | Status |
|---|---|
| I — Maintainable Code Quality | Three small scripts, one documented contract each; redaction in exactly one place |
| II — Secure by Design | This change *is* a Principle II control. Least privilege (`contents: read`), untrusted input never interpolated into shell, negative tests for injection and fail-closed |
| III — Test-First Evidence | Tests written and observed failing before each implementation; 39 tests committed. SAST portion reduced to config lints, disclosed above |
| IV — Consistent and Accessible UX | N/A — no CrewSafe end-user surface. Every verdict stated in text, never colour alone |
| V — Measured Performance and Reliability | Endpoint p95 N/A. Gate budget 10 min p95; PR cost proportional to the PR, not repo age; fail-closed with bounded timeout |
| Engineering Constraints | ADR 0010 records the external-service data boundary, as `AGENTS.md` §8 requires |
