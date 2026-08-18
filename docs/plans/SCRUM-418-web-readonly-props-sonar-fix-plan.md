# SCRUM-418 — Web Readonly Props Sonar Fix

**Branch:** `fix/scrum-418-sonar-readonly-props`

**Jira:** SCRUM-418

**Date:** 2026-08-17

## Scope

This change resolves the scoped web SonarQube prop-readonly findings and the `AuthProvider` nullish-assignment finding. It applies `Readonly<...>` to the 22 enumerated component signatures across 18 `web/src` files and replaces the equivalent nullable manager guard with `managerRef.current ??= userManager ?? getProductionUserManager()`.

The change is type/idiom-only. It does not change rendered output, accepted prop values, authentication behavior, API contracts, persistence, tests, or deployment configuration. `EditShiftForm.tsx` remains outside SCRUM-418, as do the import, condition-stream, and CSS findings assigned to other work items.

The attached walkthrough says 21 S6759 findings but enumerates 22 signatures; Jira's grouped description includes the separately owned `EditShiftForm` finding. The final SonarQube analysis must reconcile these counts.

## Implementation decisions

- Keep the existing local inline prop shapes and wrap them in `Readonly<...>`; do not introduce named interfaces for one-use component contracts.
- Use `??=` to preserve nullish-only lazy initialization and the injected `UserManager` test path.
- Add no tests: existing typecheck, auth regression, lint, and Vitest coverage are the proportional regression evidence for this compile-time/idiom-only change.
- Keep the diff limited to the 18 approved `web/src` implementation files.

## Local verification evidence

| Check | Result |
| --- | --- |
| Pre-change `npm run typecheck` in `web/` | Passed |
| Pre-change `npm run lint` in `web/` | Passed with two existing Fast Refresh warnings; 0 errors |
| Pre-change `npm test` in `web/` | 30 files / 212 tests passed |
| Focused `AuthProvider.productionManager.test.tsx` | 1 test passed |
| Post-change `npm run typecheck` in `web/` | Passed; no prop mutation exposed |
| Post-change `npm run lint` in `web/` | Passed with the same two existing warnings; 0 errors |
| Post-change `npm test` in `web/` | 30 files / 212 tests passed |
| `npm run audit` in `web/` | 0 vulnerabilities |
| Scope and whitespace review | 18 expected source files changed; no tests, `EditShiftForm`, imports, condition-stream, or CSS files changed; `git diff --check` passed |

## Pending CI evidence

The same-revision SonarQube result is not available locally. `sonar-scanner` is not installed, and this branch has not been published. Before review closure, CI must confirm zero scoped `typescript:S6759` findings, resolution of the scoped `typescript:S6606` finding, no new findings in touched files, and the reconciled before/after count. No Sonar token or generated report is stored in this repository.

## Constitution compliance

- Maintainability: the smallest local type/idiom transformations were used.
- Security: no authentication, authorization, credential, API, or logging boundary changed; dependency audit passed.
- Testing: baseline and post-change typecheck, lint, focused auth regression, and full suite passed without test changes.
- UX/accessibility: no rendered state, copy, interaction, or safety meaning changed.
- Performance/reliability: no runtime data path or endpoint changed; unavailable external Sonar evidence is reported as pending rather than assumed.
