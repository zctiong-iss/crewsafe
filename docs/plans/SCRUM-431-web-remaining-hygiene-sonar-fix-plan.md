# SCRUM-431 — Web Remaining Hygiene Sonar Fix

**Branch:** `fix/scrum-431-web-hygiene`

**Jira:** SCRUM-431 (subtask of SCRUM-400)

**Date:** 2026-08-17

## Scope

This change resolves the 8 remaining SCRUM-431 web SonarQube findings across 4 files: `streamLogic.ts` (2× `typescript:S3863` duplicate import, `typescript:S7755` `.at()`, 2× `typescript:S6582` optional chain), `AuthNotice.tsx` (`typescript:S6772` JSX spacing), `AppShell.css` (`css:S4656` duplicate `flex`), and `tokens.css` (`css:S125` dead comment).

The change is syntax/idiom-only. It does not change rendered output, SSE trend-buffer or stop-work-guard behavior, computed CSS, authentication behavior, API contracts, persistence, tests, or deployment configuration. `AuthNotice.tsx`'s `<p>`→`<output>` element swap (SCRUM-420) was already on `main` before this branch; this change only adds the missing explicit JSX space. Findings owned by SCRUM-411, SCRUM-418, and SCRUM-424 remain outside this change.

## Implementation decisions

- Merge the two `@/api/conditionsStream` type imports into one statement.
- Replace `buffer[buffer.length - 1]` with `buffer.at(-1)` in `appendTrendPoint` — identical result for empty and non-empty buffers.
- Replace `last && last.observedAt === c.observedAt` with `last?.observedAt === c.observedAt`, and `lightning === null || lightning.state !== "STOP_WORK"` with `lightning?.state !== "STOP_WORK"` — both proven truth-table-identical in `specs/053-web-hygiene-sonar-fix/research.md` (Decisions 3–4). The `isStopWorkActive` guard is safety-adjacent (stop-work state), so behavioral identity was treated as load-bearing, not cosmetic.
- Add one `{" "}` JSX expression between the decorative pulse `<span aria-hidden="true" />` and `Working` in `AuthNotice.tsx`'s existing `<output>` block; no element or attribute change.
- Delete the shadowed `flex: 1;` declaration in `.shell__nav` (`AppShell.css`), keeping the effective `flex: 1 1 100%;` — proven by CSS cascade order (last declaration of equal specificity wins).
- Delete the commented-out `--font-ui: "IBM Plex Sans", ...` line and its orphaned "Lexend was chosen instead" changelog note from `tokens.css`; keep the live `--font-ui` declaration and the unrelated `--font-code` documentation comment.
- Add no tests: every edit is a proven behavior-preserving transform; the existing `streamLogic.test.ts` and `AuthNotice.test.tsx` are the regression evidence.

## Local verification evidence

| Check | Result |
| --- | --- |
| Pre-change `npm run typecheck` in `web/` | Passed |
| Pre-change `npm run lint` in `web/` | Passed with two existing Fast Refresh warnings; 0 errors |
| Pre-change `npm test` in `web/` | 33 files / 232 tests passed |
| Focused `streamLogic.test.ts` (`appendTrendPoint`, `isStopWorkActive`) | 10 tests passed |
| Focused `AuthNotice.test.tsx` | 1 test passed |
| Post-change `npm run typecheck` in `web/` | Passed; no narrowing regression |
| Post-change `npm run lint` in `web/` | Passed with the same two existing warnings; 0 errors |
| Post-change `npm test` in `web/` | 33 files / 232 tests passed — identical to baseline |
| `npm run audit` in `web/` | 0 vulnerabilities |
| Scope and whitespace review | Exactly 4 expected source files changed (`git diff --name-only`); `git diff --check` passed; no test, package manifest, or SCRUM-411/418/420/424-owned file touched |
| Directory-sweep closure check (during specification) | Live SonarQube query of `web/src/auth/`, `web/src/features/conditions/`, `web/Dockerfile`, `web/nginx.conf` returned no unowned open finding beyond the 8 scoped here, satisfying SCRUM-400's "no unowned open findings" closure condition for this subtask |

## Pending CI evidence

The same-revision SonarQube result is not available locally — SonarQube analyzes committed/pushed code via CI, not the local working tree, and this branch has not been pushed. Before review closure, CI must confirm zero of the 8 scoped findings, no new finding in the 4 touched files, and a reconfirmed directory sweep. No Sonar token or generated report is stored in this repository.

## Constitution compliance

- Maintainability: each fix is the minimal mechanical transform the Sonar rule targets; no new abstraction introduced.
- Security: no authentication, authorization, credential, API, or logging boundary changed; the one safety-adjacent guard (`isStopWorkActive`) was verified behaviorally identical; dependency audit passed.
- Testing: baseline and post-change typecheck, lint, focused regressions, and full suite passed without test changes.
- UX/accessibility: no rendered state, copy, interaction, `aria-hidden` semantics, or computed layout changed.
- Performance/reliability: no runtime data path or endpoint changed; unavailable external Sonar evidence is reported as pending rather than assumed.
