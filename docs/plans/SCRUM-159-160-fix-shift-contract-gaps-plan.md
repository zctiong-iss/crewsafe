# SCRUM-159/160-fix — Two gaps in the shift contract, closed

## Outcome

Closes two gaps in the SCRUM-159/160 shift contract, both found while building
SCRUM-161 (the create-shift form) against the merged API:

1. **No correction path.** A shift and its assignments were create/read/add-only —
   there was no way to fix a mis-entered field or remove one. `PATCH`/`DELETE` on a
   shift and `PATCH`/`DELETE` on an assignment close that.
2. **No worker picker source.** Nothing returned a site's workers, so the create-shift
   form had no candidates for `assignments[].workerId`. `GET /sites/{siteId}/workers`
   closes that.

Both are additive: `docs/api/shift.yaml` bumped to `1.1`, no existing path or schema
changed shape.

## Design decisions

- **Correcting a shift is data-entry only, not a status transition.** `PATCH
  .../shifts/{shiftId}` only accepts `startsAt`/`endsAt`. `status` stays
  server-controlled — no transition endpoint exists yet (unchanged from SCRUM-160),
  and this ticket doesn't add one. Both fields are required on the request, same as
  create, rather than a genuine partial patch — avoids the case where one corrected
  field combines with the existing value of the other to produce an invalid range.
- **`workerId` is not patchable on an assignment.** `PATCH
  .../assignments/{assignmentId}` only accepts `taskName`/`intensity`/
  `acclimatisationDay`. Reassigning to a different worker is `DELETE` the wrong
  assignment, `POST` the right one — that path already exists, and giving the same
  outcome two different shapes was worse than just pointing at the one that works.
- **Deleting a shift cascades to its assignments** in the service layer, not the
  database: `shift_assignment.shift_id` has no `ON DELETE CASCADE` (and this ticket
  doesn't add one — an ALTER TABLE on a live constraint is a bigger, separate
  decision than a bug-fix ticket should carry). `ShiftService.deleteShift` deletes
  the assignments first, then the shift, in one transaction.
- **The site-workers endpoint is role-gated the same as shift creation**
  (`SUPERVISOR`/`SAFETY_MANAGER`/`ADMIN`), not open to any site member. It's a
  supervisor-tool query (populating a picker to plan a shift), not something a
  worker needs about their own site.
- **Only `ACTIVE` `WORKER`-role members are returned** by the site-workers endpoint.
  An offboarded worker isn't a valid new assignment candidate, and a supervisor
  isn't a worker — both are filtered at the query level
  (`AppUserRepository.findBySiteIdAndRoleAndStatus`), not in Java, so the picker
  never even receives rows it would have to hide.
- **Every new mutating endpoint audits**, matching the precedent SCRUM-160 set for
  create: `SHIFT_UPDATED`, `SHIFT_DELETED`, `SHIFT_ASSIGNMENT_UPDATED`,
  `SHIFT_ASSIGNMENT_REMOVED`. Same `afterCommit`-deferred pattern the Copilot review
  on SCRUM-160 established (see that ticket's plan doc) — none of these new writes
  reintroduce the audit-survives-rollback bug that pattern exists to prevent.

## What was built

- `docs/api/shift.yaml` — 3 new paths (`PATCH`/`DELETE .../shifts/{shiftId}`,
  `PATCH`/`DELETE .../shifts/{shiftId}/assignments/{assignmentId}`,
  `GET /sites/{siteId}/workers`), 3 new schemas (`ShiftUpdateRequest`,
  `ShiftAssignmentUpdateRequest`, `SiteWorker`).
- `Shift.correctTimes(...)` / `ShiftAssignment.correct(...)` — narrow, purpose-built
  mutators, not blanket setters. `siteId`, `status`, `shiftId` and `workerId` stay
  untouchable through these methods on purpose, matching the entities' existing
  narrow-mutation style.
- `ShiftAssignmentRepository.findByIdAndShiftId` / `.deleteByShiftId` —
  site/shift-scoped assignment lookup and the delete-cascade helper.
- `AppUserRepository.findBySiteIdAndRoleAndStatus` — the "site → users" mirror of
  the existing `SiteMembershipRepository.findSiteIdsByUserId` ("user → sites"),
  filtered to role and status in the query itself. Uses
  `idx_site_membership_site` (`V1__baseline_identity.sql`) — **already existed**,
  no new migration needed (the original feedback's caveat about needing one didn't
  hold once checked).
- `ShiftService.updateShift` / `.deleteShift` / `.updateAssignment` /
  `.removeAssignment`, plus a shared `afterCommit` helper factored out of
  `createShift` so all five mutating methods defer their audit write the same way.
- `ShiftController` — 4 new endpoints, same site-scoping and role-gating pattern as
  the rest of the class.
- `SiteController.listSiteWorkers` — the new `GET /{siteId}/workers` endpoint.
- Tests: 18 new cases in `ShiftControllerTest` (correct/delete a shift, correct/
  remove an assignment — happy path + audit assertion, bad-request, 404 on both the
  shift and the assignment leg, role-forbidden, one cross-site-forbidden as a
  representative of the shared `@siteAccess` check) plus a new `SiteWorkersTest`
  (6 cases: role+status filtering, alphabetical ordering, empty-site, cross-site
  403, role-forbidden, unauthenticated). Full relevant suite: 153/153 passing.

## Two unrelated bugs found while verifying this — not fixed here

Both block `main`'s test suite independent of anything in this ticket. Neither is
touched by this PR; each needs its own fix.

1. **`AppUser` had no `@Builder`.** `ActionDispatchControllerTest` /
   `ActionDispatchServiceTest` (already merged) call `AppUser.builder()...`, which
   didn't exist — `main`'s test sources didn't compile at all. Fixed on its own
   branch: `fix/appuser-builder-missing-for-action-dispatch-tests`, PR #48.
2. **`BedrockProperties` is registered twice** — `@Component` *and*
   `@EnableConfigurationProperties(BedrockProperties.class)` — producing a
   `NoUniqueBeanDefinitionException` that fails the Spring context for essentially
   every `AbstractIntegrationTest`-based test in the suite. Reported, not fixed
   (explicitly deferred, not my call to make unilaterally). To verify this ticket's
   own tests locally, `@Component` was removed from that file **temporarily and
   locally only** (never committed) just long enough to run the suite, then
   reverted before committing anything here.

## Dependencies

Builds on the already-merged SCRUM-159 (`docs/api/shift.yaml`, PR #42) and SCRUM-160
(shift backend, PR #43). Both are on `main`; this branch was cut from a fresh `main`
pull, not from either of those branches.

## Implementation

**2026-08-02 — shipped, PR #49.**

File by file, in plain English:

- **`docs/api/shift.yaml`** — the contract, bumped `1.0` → `1.1`. Added the 5 new
  routes (`PATCH`/`DELETE` on a shift, `PATCH`/`DELETE` on an assignment,
  `GET /sites/{siteId}/workers`) and 3 new schemas (`ShiftUpdateRequest`,
  `ShiftAssignmentUpdateRequest`, `SiteWorker`). Purely additive — nothing existing
  changed shape.
- **`Shift.java`** — added `correctTimes(startsAt, endsAt)`. Deliberately narrow: it
  can only change the time range, not `siteId` or `status` — those stay untouchable
  through this method on purpose, matching how `SiteMembership` and other entities in
  this codebase avoid blanket setters.
- **`ShiftAssignment.java`** — added `correct(taskName, intensity,
  acclimatisationDay)`. Same idea, and `workerId` is pointedly excluded — reassigning
  a shift to a different worker is "remove this assignment, add a new one" through
  the endpoints that already existed from SCRUM-160, not an in-place edit.
- **`ShiftAssignmentRepository.java`** — two new lookups: `findByIdAndShiftId` (so an
  assignment id from a different shift correctly comes back "not found" instead of
  leaking across shifts) and `deleteByShiftId` (bulk-remove every assignment on a
  shift in one query, used by the shift-delete path).
- **`AppUserRepository.java`** — one new query, `findBySiteIdAndRoleAndStatus`: given
  a site, returns only the `AppUser`s who are `ACTIVE` and have role `WORKER` there,
  sorted by display name. This is the query behind the new worker-picker endpoint.
- **`ShiftService.java`** — added `updateShift`, `deleteShift`, `updateAssignment`,
  `removeAssignment`, all `@Transactional`. Two things worth calling out:
  - `deleteShift` deletes a shift's assignments *before* the shift itself, in the
    same transaction — `shift_assignment.shift_id` has no `ON DELETE CASCADE`, so the
    app has to do the deletion in the right order or the shift delete would fail on
    the foreign key.
  - The "only write the audit entry after the transaction actually commits" logic
    that SCRUM-160's Copilot review introduced (an audit entry written inline could
    otherwise survive a rollback and falsely claim work that never happened) was
    pulled out into one shared `afterCommit(...)` helper, so all four new
    write-methods reuse it instead of each repeating the same
    `TransactionSynchronizationManager` boilerplate.
- **`ShiftController.java`** — 4 new REST endpoints: `PATCH`/`DELETE .../shifts/
  {shiftId}`, `PATCH`/`DELETE .../shifts/{shiftId}/assignments/{assignmentId}`. Same
  rule as shift creation: only `SUPERVISOR`/`SAFETY_MANAGER`/`ADMIN` can call them,
  and only for a site they belong to (`@siteAccess.canAccess`).
- **`SiteController.java`** — added `GET /{siteId}/workers`, gated the same way
  (supervisor/safety-manager/admin only — a worker doesn't need this list). Calls the
  new repository query and returns just `id` + `displayName`, nothing else, so the
  picker never receives a row it would have to hide client-side.
- **`AuditEventType.java`** — 4 new constants: `SHIFT_UPDATED`, `SHIFT_DELETED`,
  `SHIFT_ASSIGNMENT_UPDATED`, `SHIFT_ASSIGNMENT_REMOVED`.
- **`ShiftControllerTest.java`** — 18 new cases: correct/delete a shift and correct/
  remove an assignment, each with a happy path (including an audit-row assertion),
  a bad-request case, 404 on both the shift leg and the assignment leg, a
  wrong-role case, and one cross-site-forbidden case representative of the shared
  `@siteAccess` check.
- **`SiteWorkersTest.java`** (new file) — 6 cases: role+status filtering,
  alphabetical ordering, an empty site returns `[]` not an error, a supervisor from
  another site is forbidden, a worker calling it is forbidden, and unauthenticated
  is rejected.

### Verification

Full relevant suite run repeatedly across the PR's iterations: `153/153` passing
(excluding the pre-existing, unrelated `ActionDispatchControllerTest` compile
failure — see "Two unrelated bugs" above).

### Outcome

PR #49, shipped 2026-08-02. The `AppUser.builder()` fix that blocked local
verification was pulled out to its own PR (#48), then closed once it turned out
PR #47 — a separate, pre-existing, unmerged PR — already contained the identical
fix as part of a larger change set.
