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

## Implementation

**2026-08-02 — shipped, PR #43.**

### Contract dependency

`docs/api/shift.yaml` — the OpenAPI spec these endpoints implement — lives on a
separate, still-open PR (#42, `contract/scrum-159-shift-openapi`) rather than this
one. This PR is built against its content but does not include the file itself,
so each Jira ticket's PR carries only what that ticket owns; #42 brings the
contract into `main` on its own.

### What was built (all brand new — nothing like this existed before)

- **`Shift.java` / `ShiftAssignment.java`** (`backend/.../shift/domain/`) — the two
  JPA entities. These are the Java classes that map onto the `shift` and
  `shift_assignment` database tables that already existed (from `V3__domain_schema.sql`)
  but had no code reading or writing them yet.
- **`ShiftStatus.java` / `Intensity.java`** (same package) — small enums
  (`PLANNED/ACTIVE/CLOSED` and `LIGHT/MODERATE/HEAVY`) mirroring the database's
  `CHECK` constraints.
- **`ShiftRepository.java` / `ShiftAssignmentRepository.java`** (`.../shift/repository/`)
  — the database-access layer (Spring Data). Lets a shift be looked up scoped to its
  site (so a shift id from another site correctly comes back "not found"), and lets
  all assignments for a batch of shifts be fetched in one query instead of one query
  per shift.
- **`ShiftService.java`** (`.../shift/service/`) — the business-rule layer: rejects
  `endsAt` before `startsAt`, creates a shift with zero or more assignments in one
  call, writes an audit-log entry every time a shift is created, and handles staffing
  an already-existing shift later.
- **`ShiftController.java`** (`.../shift/api/`) — the actual REST endpoints
  (`GET/POST /api/v1/sites/{siteId}/shifts`, `GET .../shifts/{shiftId}`,
  `POST .../shifts/{shiftId}/assignments`), built to match `SiteController`'s
  existing shape exactly.
- **`BadRequestException.java`** (`common/error/`) + one new handler method in the
  existing `GlobalExceptionHandler.java` — needed because nothing in the codebase
  yet could turn a deliberate validation failure (like a bad date range) into a clean
  400 response with a specific message.
- **`AuditEventType.SHIFT_CREATED`** — one new constant added to the existing
  `AuditEventType.java`, the audit-log label written every time a shift is created.
- **`ShiftControllerTest.java`** (`backend/src/test/.../shift/`) — 11 automated tests:
  create-then-read-back, create-empty-then-staff-later, list ordering, cross-site
  create blocked with 403 (this was a test SCRUM-156 explicitly deferred to this
  ticket), an audit-log entry gets written, bad date ranges and missing intensity are
  rejected with 400, unknown shift ids come back 404, and a worker is blocked from
  creating or staffing a shift even at their own site (see below).

### Authorization: who can do what

Every endpoint requires the caller be a member of that site (`@siteAccess.canAccess`,
reused from SCRUM-156 — nothing new here). On top of that, creating a shift and
adding an assignment to one are restricted to `SUPERVISOR`, `SAFETY_MANAGER`, or
`ADMIN` — a `WORKER` gets a 403 even at their own site. This is **not** in
`docs/api/shift.yaml` itself, which only specifies a membership-based 403, no role
check — the contract covers *which site*, not *which role* may write. Reading a
site's shift list/detail stays open to any site member.

### Verification

Full backend suite run repeatedly across the PR's iterations: `111/111` passing,
no regressions.

### Review fixes (GitHub Copilot PR review)

Three findings, all genuine, all fixed:

1. **Audit event could survive a rollback.** `AuditService.record` runs in
   `REQUIRES_NEW`, so calling it inline inside `createShift`'s transaction would
   commit the audit row immediately and independently — if the shift or an
   assignment then failed to persist (e.g. a `workerId` with no matching
   `app_user` row, violating the `shift_assignment` foreign key at commit time),
   the audit event would outlive the rollback and falsely claim a shift was
   created. Fixed by deferring the audit write to `afterCommit` via
   `TransactionSynchronizationManager`. Proven with a new test that forces the FK
   violation and asserts no audit event results.
2. **`BadRequestException`'s message was being returned to the client**, which
   quietly broke this file's own stated rule that no response ever carries an
   exception's message. Safe today (the only caller passes a hardcoded string),
   but fragile for whichever call site is added next. Now logged server-side only;
   the client gets the same fixed `"Invalid request parameters"` every other 400
   in this file already returns.
3. **`listShifts` had no deterministic tiebreaker.** Two shifts created within the
   same timestamp resolution could come back in either order, making "most
   recently created first" flaky. Added `id` as a secondary sort key (not
   semantically meaningful, purely for determinism).
