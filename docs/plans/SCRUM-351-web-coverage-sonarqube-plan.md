# SCRUM-351 — Web SonarQube Coverage Reporting

## Decision

The repository-root `SAST (SonarQube)` job is the sole owner of web coverage ingestion,
alongside its existing mobile, backend, and ML-service coverage. Before its scanner runs, it
installs the existing `web/` dependency set, runs the Vitest suite under the pinned
`@vitest/coverage-v8` provider (`npm run test:coverage`), normalizes the emitted
`web/coverage/lcov.info` into repository-relative `web/coverage/sonar-lcov.info` (prefixing
`SF:` lines with `web/`, mirroring the pre-existing mobile normalization step), and rejects a
report that is missing, empty, or contains any `SF:` line outside `web/src/`.

`sonar-project.properties` consumes that report by adding `web/coverage/sonar-lcov.info` to
`sonar.javascript.lcov.reportPaths` alongside — not replacing — the existing mobile entry. No new
test-classification rule was needed: the existing `web/src` inclusion in `sonar.tests` and
`sonar.test.inclusions` already covers Vitest's `*.test.ts(x)` naming. `web-ci.yml` retains its
separate build/lint/plain-test role; it does not generate or upload coverage.

Two new deterministic unit test files close the only real security-relevant coverage gaps found
in `web/src`: `web/src/auth/authConfig.test.ts` (the `required()` throw-on-missing-env-var path)
and `web/src/api/errors.test.ts` (`messageFor()`'s full mapping, and the 401-vs-403 distinction
its own doc comment identifies as the reason the taxonomy exists). Protected-route behaviour was
already exercised end-to-end by the pre-existing `web/src/app/routeAccess.test.tsx`; no new test
was needed there.

## Safety and security controls

- The SAST workflow remains `contents: read`; no new credential or Cognito/backend action was
  added for coverage generation.
- The web LCOV validation is fail-closed and stricter than a "report exists" check: it rejects a
  normalized report unless **every** `SF:` line is `web/src/`-prefixed and at least one is
  present — not merely one matching line among possibly out-of-scope others.
- The new tests use only mocked `import.meta.env` values (via `vi.stubEnv`, the existing
  `setup.ts` convention) and synthetic `ApiError` fixtures; no live Cognito, backend, or personal
  data is used.
- `web/coverage/` is excluded from source control by a new `web/.gitignore`, mirroring
  `mobile/.gitignore`, and verified untracked after a real local coverage run.
- Guard tests (`test-web-sonar-coverage.sh`) check the report contract, workflow ordering,
  SonarQube configuration, and deliberate invalid-report/mutation cases, and are wired into the
  `Gate Self-Tests` job — unlike the ML-service coverage guard from SCRUM-346, which was written
  but never wired into that job.

## Regression found and fixed during implementation

Both `test-sast-gate-config.sh` and `test-ml-service-sonar-coverage.sh` had a pre-existing
`$`-anchored assertion expecting `sonar.javascript.lcov.reportPaths` to equal **only** the mobile
path. Adding web's path broke both silently until caught by running the full affected guard set
locally before commit. Both assertions were updated to check that the mobile path is present
(not that it is the sole value), and a matching assertion was added for the web path.

## Local verification evidence

Completed on 2026-08-13:

- `npm install` in `web/` resolved `@vitest/coverage-v8` cleanly against the existing lockfile;
  `npm ci` remains reproducible.
- `npm run test:coverage` in `web/`: 23 test files, 160 tests passed. Overall coverage 91.5%
  statements / 87.5% branches / 81.1% functions / 91.5% lines. Target files:
  `src/auth/authConfig.ts` 39/39 lines, `src/api/errors.ts` 30/30 lines, `src/app/RoleRoute.tsx`
  6/6 lines.
- The workflow's exact `awk` normalization logic was run manually against the real generated
  report: produced a non-empty `web/coverage/sonar-lcov.info` with every `SF:` line
  `web/src/`-prefixed.
- `git status` after a full local coverage run shows `web/coverage/` untracked.
- `test-web-sonar-coverage.sh`: 17 passed, including missing/empty/unprefixed/out-of-scope-path
  rejection and mutation cases (dropped web path, dropped mobile path, removed validation step).
- `test-sast-gate-config.sh`: 47 passed (including the fixed web+mobile LCOV assertion).
- `test-sonar-gate-configure.sh`: 84 passed. `test-web-ci-runtime-config.sh`: 23 passed.
- `test-ml-service-sonar-coverage.sh`: 22 passed (including the fixed mobile-LCOV assertion —
  see regression note above).
- `test-log-safety-guards.sh`: 399 passed (repository-wide; unaffected by this change).
- `npm run test`, `npm run typecheck`, and `npm run lint` in `web/`: all clean (the one existing
  ESLint warning is in `AuthProvider.tsx`, untouched by this feature).

## Required PR evidence

Before merge, attach the pull-request `SAST (SonarQube)` result showing that the same revision's
`web/coverage/sonar-lcov.info` was consumed and that SonarQube displays non-zero web coverage
alongside non-zero mobile coverage. Do not include the Sonar token, generated report contents, or
sensitive runtime data.
