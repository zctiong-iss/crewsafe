# SCRUM-295: SCA Dependency-Risk Backlog Burn-Down

**Status**: Implemented, pending CI re-scan confirmation and operator
application of the two recorded exceptions.

**Jira**: [SCRUM-295](https://u-team-h6ii4x03.atlassian.net/browse/SCRUM-295)
(subtask of SCRUM-146). Spec Kit artifacts: `specs/056-sca-dependency-backlog/`
(gitignored — see that directory's `spec.md`, `plan.md`, `research.md`,
`tasks.md`, `triage.md` for full detail; this file is the durable summary).

## Context

SonarQube Cloud's SCA (dependency-risk) analysis for project
`zctiong-iss_crewsafe` reported 127 total findings (115 OPEN) as of
2026-08-18, spanning Maven (backend), PyPI (ml-service), and npm
(web/mobile). SCRUM-269 had already scoped the CI Quality Gate's
`new_sca_rating_vulnerability` condition to New Code only, deliberately
deferring the pre-existing backlog — this ticket burns that backlog down.
Widening the gate to Overall Code is explicitly out of scope here (stays a
follow-up).

## What changed

**`backend/pom.xml`**: Spring Boot parent bumped 3.5.13 → 3.5.16 (latest
available 3.x patch; 4.1.0 exists but is a major/out-of-scope bump). This
single change resolved the large majority of findings — Tomcat, Netty,
Jackson, Spring Security, Spring Data, Spring Web/Core/Expression, and
`org.postgresql:postgresql` are all managed by that BOM and moved together.
Four artifacts the BOM bump alone didn't reach got explicit overrides:
`log4j2.version` → 2.26.1, `commons-lang3.version` → 3.20.0,
`httpclient5.version` → 5.6.4, `httpcore5.version` → 5.4.3 (all Spring Boot
BOM property overrides), plus an explicit `<dependencyManagement>` pin for
`commons-compress` → 1.28.0 (no Boot property exists for it; pulled in via
testcontainers, test-scope only). `./mvnw verify`: 663 tests, 0 failures.

**`ml-service/requirements.txt` + `.in` source files**: `joblib` 1.4.2 →
1.5.3, `python-dotenv` 1.0.1 → 1.2.3, `pytest` 8.3.5 → 8.4.2 (stayed within
the 8.x line; 9.1.1 exists but is a major/out-of-scope bump). Bumping pytest
introduced a previously-unpinned transitive dependency on `pygments`, which
`--require-hashes` mode requires to be explicitly pinned — added
`pygments==2.21.0` with a verified hash. `langgraph-sdk` stays at 0.4.2: it
is already the latest version published on PyPI, so no fix exists yet
(excepted — see below).

**`mobile/package.json`**: added an `overrides` block pinning three
transitive-only packages that their immediate parents
(`@expo/plist`, `xcode`, `query-string`) have not themselves updated to fix:
`@xmldom/xmldom` → 0.9.11, `uuid` → 14.0.1, `decode-uri-component` → 0.3.0.
Note `decode-uri-component` is pinned to 0.3.0, not npm's latest 0.5.0 —
0.4.0+ switched the package to ESM-only, which broke Jest's CommonJS
transform for `query-string`'s `require()` of it (caught by
`WorkerTabs.test.tsx` failing with "Unexpected token 'export'" when first
tried at 0.5.0). 0.3.0 carries the same fix while staying CommonJS-compatible.
Full Jest suite: 89/89 suites, 1542/1542 tests passed after the correction.

**`web/`**: no change. `npm ls` confirms none of the three flagged npm
packages exist anywhere in `web/`'s dependency tree — `search_dependency_risks`
returns project-wide findings (one row per package+version across the whole
monorepo, not per module), so those findings were attributable to `mobile/`
only. `web/`'s own Vitest suite (232/232) was still run to confirm it's
unaffected.

**`.github/security/sca-exceptions.yml`**: two new entries, both for
findings with no available fix (the affected package is already at the
latest version published upstream) — `org.hdrhistogram:HdrHistogram`
(CVE-2026-14686) and `langgraph-sdk` (CVE-2026-14742). Both expire
2026-11-16, for re-check in case an upstream fix ships by then.

## What's still open

- **CI re-scan**: SonarCloud only re-analyzes on push/CI run, not local file
  state — the fixes above need a real scan against the merged branch to
  confirm they actually clear the flagged findings before SC-001 can be
  called fully verified.
- **Exception application**: `.github/scripts/security/apply-sca-exceptions.sh`
  requires `SONAR_ADMIN_TOKEN` (an org-admin secret, intentionally excluded
  from this session's environment and from automatic CI per the script's own
  design). A human operator with that token must run it against
  `.github/security/sca-exceptions.yml` to actually transition the two
  excepted findings on SonarCloud's side.
- **ml-service test suite**: full local run was in progress at the time this
  note was written (a fresh-venv install of ~90 packages plus the full
  pytest run); see the PR/session for its final result. `pip install
  --require-hashes -r requirements.txt` itself succeeded cleanly.

## Constitution compliance

Principle II (Secure by Design): this work directly reduces the unreviewed
dependency-risk backlog; every remaining gap is either fixed or has a
reviewed, time-bounded exception — none left silent. Principle III
(Test-First Evidence): no new production business logic was added, so
"test-first" here took the form of a captured failing baseline (the live
untriaged-finding list) plus the existing per-ecosystem regression suites as
the pass/fail gate for every bump, per the interpretation recorded in
`specs/056-sca-dependency-backlog/plan.md`'s Constitution Check. Principle I:
the Spring Boot BOM bump was chosen specifically because it is the simplest
design that resolves the largest share of findings in one change, versus
pinning ~20+ artifacts individually.
