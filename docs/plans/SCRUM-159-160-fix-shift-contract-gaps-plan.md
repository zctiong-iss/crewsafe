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
