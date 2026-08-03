# SCRUM-161 — Web create-shift form plan

## Outcome

The web app gains its first real feature screen: a supervisor can create a shift for their
own site and staff it with workers, tasks and work intensity, against the endpoints shipped
in SCRUM-160 and the contract in [`docs/api/shift.yaml`](../api/shift.yaml). Client-side
validation mirrors the contract's constraints, and the 401/403 distinction is handled the way
[`web/src/api/errors.ts`](../../web/src/api/errors.ts) requires.

`web/src/features` currently holds only `home` and `placeholder`, so this is the first screen
in the app with real behaviour behind it.

## Starting-state findings

Read against `main` before planning. Three things the ticket did not mention. **Two were
raised with Abu Bakar on 2 Aug and closed by PR #49 the same afternoon** — recorded here
because the design below was shaped by them.

**1 — Nothing returned the workers of a site (W-20). CLOSED, PR #49.**
`assignments[].workerId` is a required UUID and nothing supplied candidates. Now
`GET /api/v1/sites/{siteId}/workers` returns `SiteWorker { id, displayName }` — only members
with `role = WORKER` **and** `status = ACTIVE`, alphabetical, behind the same role gate as
shift creation. Two consequences for the picker: an offboarded worker never appears as a
candidate, and a supervisor cannot assign themselves.

*The proposal was only partly accepted.* `username` was argued for on the grounds that two
people on a site can share a display name; it was not included. That risk is real and now
unmitigated — see *Known limitations*.

**2 — Shifts and assignments had no correction path (W-19). CLOSED, PR #49.**
`PATCH` and `DELETE` now exist on both `/shifts/{shiftId}` and
`/shifts/{shiftId}/assignments/{assignmentId}`. Deletes are hard (`204`), and deleting a shift
removes its assignments with it.

One design detail worth carrying into the UI: `ShiftAssignmentUpdateRequest` **deliberately
cannot change `workerId`**. A wrong worker means `DELETE` then `POST`, not reassignment in
place — an assignment is a fact about a person on a shift, not a mutable slot, and rewriting
it silently is what SCRUM-183's append-only audit trail exists to prevent. `intensity` stays
required on update, never left unchanged by omission.

**3 — Per-field validation errors are not achievable end to end (W-08).**
`ErrorResponse` is `{error, message, requestId}` with no per-field channel, and
[`client.ts:58-60`](../../web/src/api/client.ts) discards the response body without parsing
it, so even an added `fieldErrors` would not reach the UI. Blocked at both ends. Constrains
what this ticket can promise — see *Known limitations*.

## Approved design

- **The worker lookup lives behind `fetchSiteWorkers(siteId): Promise<SiteWorker[]>`** in
  `web/src/api/`, one line over `apiFetch`, following the shape of `fetchAccessibleSites()` in
  `identity.ts`. The type is named `SiteWorker` to mirror `SiteController.SiteWorkerResponse`
  exactly — **a mirror over a locally-invented name, because** once a real DTO exists the
  local type stops being a negotiation and starts being a contract.
- **Validation is client-side first.** Everything the contract can express — date order, the
  intensity enum, `taskName` ≤ 120, `acclimatisationDay` 1–7 — is caught before a request is
  sent. **Client-side over server-round-trip because** W-08 means a server rejection currently
  arrives as an unattributable generic string.
- **Client-side checks are convenience, not control.** Every rule here is also enforced by
  `ShiftService`; this layer exists to give fast feedback, not to be trusted.
- **`status` never appears on the form** — server-controlled, every shift is created `PLANNED`
  ([`shift.yaml:188`](../api/shift.yaml)).
- **Single submit, assignments nested.** One `POST .../shifts` carrying `assignments[]` in the
  body, rather than create-then-staff in sequence. **Nested over sequential because** two calls
  can partially fail, leaving an empty shift the supervisor did not ask for. The separate
  `POST .../assignments` endpoint stays for staffing an existing shift later, which is not this
  ticket.

### Open decision — routing shape

Not settled. Every route in [`App.tsx`](../../web/src/app/App.tsx) is currently flat
(`/shifts`, `/approvals`), with no `siteId` in any URL.

- **Flat** (`/shifts/new`, site resolved from `/api/v1/me`) — simpler, matches what exists,
  and closes the typed-URL path to a cross-site request.
- **Nested** (`/sites/:siteId/shifts/new`) — deep-linkable and shareable, which scales to
  SCRUM-134's multi-site view, but puts a user-editable site id in the address bar.

Neither is wrong. Whoever builds the next site-scoped screen inherits this, so it wants an ADR
line once decided. AC-4 holds either way.

## Acceptance criteria

**AC-1 — happy path.** *Given* a supervisor signed in with membership of site S, *when* they
submit with `startsAt` before `endsAt` and one assignment (worker + intensity `MODERATE`),
*then* a single `POST /api/v1/sites/S/shifts` is sent with `assignments[]` nested in the body,
and the returned shift — status `PLANNED` — is displayed.

**AC-2 — date order.** *Given* `endsAt` is earlier than or equal to `startsAt`, *when* the
supervisor submits, *then* **no request is sent** and an error is shown against the `endsAt`
field.

**AC-3 — optional versus invalid.** *Given* `acclimatisationDay` is blank, *then* the field is
**omitted from the request body entirely** — not sent as `null` — and no error appears.
*Given* it contains `0`, `8` or a non-integer, *then* no request is sent and an error is shown
against that field.

**AC-4 — cross-site rejection.** *Given* a supervisor submits for a site they are not, or are
no longer, a member of, *when* the API returns 403, *then* the request **was** sent, the user
**remains signed in**, everything they entered is retained, and `messageFor(error)` is
displayed with the request id. No automatic redirect.

**AC-5 — WITHDRAWN 2 Aug, evening.** This criterion described a stubbed worker source behind a
fixture, with an on-form `Demo worker list` banner and a production build guard, because no
worker endpoint existed. **PR #49 shipped the endpoint, so there is nothing left to stub** —
no fixture, no banner, no guard. Withdrawn rather than renumbered so AC-6 and the references
to it elsewhere still resolve.

The reasoning is kept because the discipline generalises: when a stand-in is unavoidable, put
the guard in the file that must die rather than the file that survives, so it leaves with the
thing it was guarding. It was not needed here in the end.

**AC-6 — empty shift.** *Given* no assignments have been added, *when* the supervisor submits,
*then* `assignments` is sent as `[]` and the shift is created. An inline, non-blocking note
near the submit button reads `No workers assigned — you can add them after creating the
shift.` **Inline over a confirmation dialog because** an empty shift is a contract-supported
workflow, not an error, and a modal on a supported path trains people to dismiss dialogs
without reading — a real cost in a safety product.

## Assumptions

**A-1 — creating an unstaffed shift is a normal roster workflow, not usually a mistake.**
Unvalidated; the team has no access to a real worksite. Drives AC-6. **If wrong**, the inline
note becomes a confirmation step. Validation path: ask a site supervisor or any domain contact
before Sprint 2 closes.

## In scope, blocked

**None — cleared 2 Aug, evening.** This section held one item, the stubbed worker source, and
PR #49 removed the dependency it was waiting on. Kept as a heading so the plan's shape is
readable against its own history.

## Explicitly out of scope

- **Editing or removing an assignment, and editing or deleting a shift.** The endpoints now
  exist (PR #49), so the original reason for excluding this — *no backend to build against* —
  is void. **It stays out of scope for a different and weaker reason: SCRUM-161's stated scope
  is create, validate, submit, and a shift list/detail view.** Editing is not named in the
  ticket. That is a scoping judgement rather than a technical constraint, so it is worth
  confirming rather than assuming — a supervisor who can create a wrong shift and not correct
  it in the same screen will report that as a bug regardless of what the ticket says.
- **Shift status transitions** — no endpoints exist (`PLANNED` only).
- **The conditions screen and anything SSE** — SCRUM-169, blocked on W-03/W-04.

## Known limitations

**Server-side rejections cannot be attributed to a field (W-08). Still open after PR #49.**
`ErrorResponse` is unchanged — `{error, message, requestId}`, no `fieldErrors` — so any 400
surfaces only as the generic `"That request was not valid."` from
[`errors.ts:56`](../../web/src/api/errors.ts). Not fixable inside this ticket: it needs a
`fieldErrors` channel on `ErrorResponse` **and** a change to `client.ts:58-60` to stop
discarding the response body. Two of the three gaps raised on 2 Aug were closed; this was not
one of them. Raise separately with the owner of `ErrorResponse.java`.

**Two active workers with the same display name are indistinguishable in the picker.**
`SiteWorker` carries `id` and `displayName` only. `username` was proposed for exactly this
reason and not included in PR #49. Client-side disambiguation does not rescue it: the only
other field available is a UUID, and showing `Ahmad Bin Ali (a3f8…)` distinguishes two rows
without telling a supervisor which is which — the appearance of a fix, which is worse than a
named gap. Assigning heat guidance to the wrong person is the failure this product exists to
prevent, so this is recorded as a limitation and put back to Abu with the concrete case:
`AppUser.username` already exists and is unique by database constraint.

## Delivery sequence

1. `SiteWorker` type and `fetchSiteWorkers(siteId)` in `web/src/api/` — one call over
   `apiFetch` against `GET /api/v1/sites/{siteId}/workers`.
2. Shift types and `createShift(siteId, body)` mirroring the contract's `ShiftCreateRequest`.
3. Form component: dates, then the assignment rows (worker, intensity, task, acclimatisation).
4. Client-side validation — AC-2, AC-3.
5. Submit, success display, and error handling — AC-1, AC-4.
6. Empty-shift note — AC-6.
7. Tests against each AC. `web/src/app/navigation.test.ts` is the nearest existing pattern.

## Dependencies

- **Depends on**: SCRUM-159 (`docs/api/shift.yaml`), SCRUM-160 (endpoints) and the
  SCRUM-159/160-fix in PR #49 (worker endpoint, correction path) — all merged to `main`.
- **Blocked by**: nothing. W-19 and W-20 both closed 2 Aug.
- **Constrained by**: W-08 (no per-field errors) and the duplicate display-name gap — neither
  blocks delivery; both are recorded under *Known limitations*.

## Handoff note

Read [`docs/api/shift.yaml`](../api/shift.yaml) first — it is the spec, not a suggestion.
`web/src/api/identity.ts` is the pattern to copy for the API layer, and
`web/src/api/errors.ts` explains the 401/403 rule this form must honour; the comment at
[`navigation.ts:18-20`](../../web/src/app/navigation.ts) explains why client-side filtering is
never the reason a check can be skipped.

**Suite status, verified 2 Aug evening: `162 tests, 0 failures, 16 errors`.** Treat the suite
as a gate for this ticket — the endpoints this form consumes are green. `ShiftControllerTest`
and `SiteWorkersTest` both pass, including everything PR #49 added.

All 16 errors are quarantined to two classes in the action-dispatch lane
(`ActionDispatchControllerTest`, `ActionDispatchServiceTest`), are test-only rather than
production defects, and are owned elsewhere. If those two are still red, that is not this
ticket regressing.

**One environment note that is not a code problem.** `JAVA_HOME` must point at Temurin 21 or
Maven fails with `release version 21 not supported` before a single test runs. `~/.zshrc` is
not read by non-interactive shells, so an IDE or tool-spawned build can pick up a different
JDK than your terminal does; set `JAVA_HOME` in `~/.zshenv` instead. Note `.sdkmanrc` pins
`21.0.12-tem` but only helps if sdkman is actually installed.
