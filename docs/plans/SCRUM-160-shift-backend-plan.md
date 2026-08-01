# SCRUM-160 — Shift and assignment service + CRUD API plan

## Outcome

The backend gains real persistence and REST endpoints for shifts, implementing the
contract already committed in [`docs/api/shift.yaml`](../api/shift.yaml) (SCRUM-159,
PR #42) field for field. A supervisor can create a shift for their own site (with or
without workers assigned at creation), list their site's shifts, read one shift's
detail, and add a worker to an existing shift.

## Starting-state correction

SCRUM-160's Jira description states that `Shift`, `ShiftAssignment`,
`ShiftRepository` and `ShiftAssignmentRepository` already exist. Verified against
`main` before starting: **they do not.** Only the database tables exist
(`V3__domain_schema.sql`) — no JPA entity, no repository, no service, no controller.
This is greenfield work, not wiring-up. (Flagged in the SCRUM-160 Jira ticket
description for the team; leaving the correction here too so a fresh session doesn't
plan around code that isn't there.)

## Approved design

- **Endpoints match `docs/api/shift.yaml` exactly** — do not improvise new fields or
  routes; if the contract needs to change, that's a contract PR first, not a
  controller-only change.
- Nested under `/api/v1/sites/{siteId}/shifts...` specifically so `@PreAuthorize`
  can reuse `#siteId` as a path variable, same as `SiteController`.
- Assignments are **optional at creation** (design choice, confirmed in
  conversation): a shift can be created with an empty `assignments` array and
  staffed later via `POST .../shifts/{shiftId}/assignments`.
- `status` is server-controlled only — every created shift starts `PLANNED`; the
  client cannot set it directly. No transition endpoints exist yet (out of scope).
- `intensity` on an assignment is **required in the request**, not silently
  defaulted, even though the database column itself defaults to `MODERATE`. This
  was a deliberate choice: intensity drives the heat-rest policy engine, so a
  missing value should be rejected, not guessed at.

## Authorization — reuse, do not reinvent

SCRUM-156 already built and fully tested row-level site-scoped authorization:
`SiteAccessEvaluator.canAccess(siteId)`, wired via
`@PreAuthorize("@siteAccess.canAccess(#siteId)")`, audits denials, exempts only
ADMIN. See `SiteController.java` for the exact pattern to copy, and
`SiteAuthorizationTest.java` for the exact test pattern to copy (MockMvc +
`AbstractIntegrationTest` + minted tokens per role/site).

The one negative test SCRUM-156 couldn't write — cross-site *write* denial —
belongs in this ticket. It was formally moved here (see the SCRUM-156 Jira comment
and the SCRUM-156↔SCRUM-160 "relates to" link): a supervisor assigned to site A who
attempts `POST /api/v1/sites/{siteB}/shifts` must get 403, using the same
`@siteAccess.canAccess` mechanism — not a new one.

## Delivery sequence

1. `Shift` and `ShiftAssignment` JPA entities, mapped to the existing `shift` /
   `shift_assignment` tables from `V3__domain_schema.sql`. Enums (`ShiftStatus`,
   `Intensity`) should mirror the DB `CHECK` constraints exactly, same as
   `docs/api/shift.yaml` does.
2. `ShiftRepository`, `ShiftAssignmentRepository` (Spring Data JPA, following the
   style of `SiteMembershipRepository`).
3. Service layer: create (with optional assignments), list-by-site, get-by-id,
   add-assignment. Emit a `SHIFT_CREATED` audit event on create, via the existing
   `AuditService` (same call shape `SiteAccessEvaluator` uses for
   `ACCESS_DENIED`).
4. REST controller implementing the four `docs/api/shift.yaml` operations, with
   `@PreAuthorize` site scoping on every method.
5. Tests: positive create/list/read/assign round-trip; cross-site create → 403
   (the moved SCRUM-156 test); audit event written on every create.

## Acceptance

- Shift with workers, tasks and intensity persists and reads back correctly.
- Cross-site create is rejected with 403 (not 404, not a silent 201).
- Audit event written on every create.

## Dependencies

- **Depends on**: SCRUM-159 contract (`docs/api/shift.yaml`, PR #42 — merge or at
  least stabilize before building against it) and the SCRUM-156 authorization
  pattern (already on `main`).
- **Blocks**: SCRUM-161 (web create-shift form), SCRUM-163 (worker shift-view /
  readiness API — needs these entities to exist), SCRUM-117 (policy engine).

## Handoff note

If picking this up in a fresh conversation: read `docs/api/shift.yaml` first — it
*is* the spec to implement, not a suggestion. `SiteController.java` and
`SiteAuthorizationTest.java` are the two files to copy the pattern from for the
controller and the tests, respectively.
