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

Read against `main` before planning. Three things the ticket does not mention.

**1 — Nothing returns the workers of a site (W-20, raised with Abu Bakar 2 Aug).**
`assignments[].workerId` is a required UUID and no endpoint supplies candidates;
`GET /sites/{siteId}/dashboard` excludes workers by design
([`SiteController.java:92`](../../backend/src/main/java/com/crewsafe/site/api/SiteController.java)).
`SiteMembershipRepository` has `findSiteIdsByUserId` — the mirror (site → users, joined to
`AppUser`) is what's needed.

This blocks rather than inconveniences: `AppUser.id` has no `@GeneratedValue` and demo users
are reconciled from the Cognito manifest at seed time, so **worker UUIDs are not stable across
environments**. A hardcoded stub list would break for anyone else pulling this branch.

**2 — Shifts and assignments have no correction path (W-19, raised with Abu Bakar 2 Aug).**
`ShiftController` exposes list, create, read and add-assignment only — no `PATCH`, `PUT` or
`DELETE` on either. A mis-entered intensity cannot be corrected and a worker cannot be
unassigned. Accepted for this ticket; see *Explicitly out of scope*.

**3 — Per-field validation errors are not achievable end to end (W-08).**
`ErrorResponse` is `{error, message, requestId}` with no per-field channel, and
[`client.ts:58-60`](../../web/src/api/client.ts) discards the response body without parsing
it, so even an added `fieldErrors` would not reach the UI. Blocked at both ends. Constrains
what this ticket can promise — see *Known limitations*.

## Approved design

- **The worker lookup lives behind `fetchSiteWorkers(siteId): Promise<Worker[]>`** in
  `web/src/api/`, following the shape of `fetchAccessibleSites()` in `identity.ts`. Today its
  body returns a local fixture; when W-20 lands, only that body changes. **A function seam
  over an inline fixture in the component, because** the signature is what makes the swap a
  one-file change instead of a refactor of everything that consumes it.
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

**AC-5 — stubbed worker source.** The worker list is supplied by a local fixture, not the API.
`fetchSiteWorkers(siteId)` is **in scope and blocked on W-20** — not deferred. Everything
downstream ships as final: picker, validation, request body, submit, error handling. While the
fixture is in use the form displays `Demo worker list — not live data`, and a production build
of the fixture module throws. Met when `fetchSiteWorkers` calls the live endpoint and the
banner is removed in the same change.

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

Building now with a stand-in, to be completed when the dependency clears. **Not** deferred
work.

| Item | Blocked on | Tripwires |
|---|---|---|
| `fetchSiteWorkers(siteId)` calling the real endpoint | W-20 | This document; the on-form banner; production build of the fixture throws |

Three tripwires because each covers a different failure: this file protects against
forgetting, the banner against a teammate or demo viewer mistaking fixture data for real, and
the build guard against it reaching users. The banner is the only one that fires during
testing; the build guard is the only one that is mechanical.

The build guard is `import.meta.env.PROD` throwing at module load, which white-screens the page
in a production build. A CI check that greps the built bundle for the fixture import would be
strictly better — it refuses to produce the artefact rather than breaking at runtime. Worth
adding once SCRUM-177's pipeline is in place.

## Explicitly out of scope

- **Editing or removing an assignment, and editing or deleting a shift** — W-19. No endpoint
  exists and none is ticketed. **No disabled or greyed-out edit control will be built**: a
  disabled control is a promise the backend has not made, and if W-19 slips it reads as a bug
  for weeks. Design intent for editing belongs in a wireframe, not in shipped code.
- **Shift status transitions** — no endpoints exist (`PLANNED` only).
- **The conditions screen and anything SSE** — SCRUM-169, blocked on W-03/W-04.

## Known limitations

**Server-side rejections cannot be attributed to a field (W-08).** If the API returns 400 —
most likely a stale `workerId` from another environment while AC-5's fixture is in use — the
UI can only show the generic `"That request was not valid."` from
[`errors.ts:56`](../../web/src/api/errors.ts). Not fixable inside this ticket: it needs a
`fieldErrors` channel on `ErrorResponse` **and** a change to `client.ts` to stop discarding the
response body. Raise separately with the owner of `ErrorResponse.java`.

## Delivery sequence

1. `Worker` type and `fetchSiteWorkers(siteId)` in `web/src/api/`, fixture-backed, with the
   production build guard.
2. Shift types and `createShift(siteId, body)` mirroring the contract's `ShiftCreateRequest`.
3. Form component: dates, then the assignment rows (worker, intensity, task, acclimatisation).
4. Client-side validation — AC-2, AC-3.
5. Submit, success display, and error handling — AC-1, AC-4.
6. Empty-shift note and the fixture banner — AC-5, AC-6.
7. Tests against each AC. `web/src/app/navigation.test.ts` is the nearest existing pattern.

## Dependencies

- **Depends on**: SCRUM-159 (`docs/api/shift.yaml`) and SCRUM-160 (endpoints) — both merged to
  `main`. W-20 for AC-5 to be met.
- **Blocked by, partially**: W-20 (worker endpoint), W-08 (per-field errors).
- **Related**: W-19 (correction path), out of scope here but the same conversation with Abu.

## Handoff note

Read [`docs/api/shift.yaml`](../api/shift.yaml) first — it is the spec, not a suggestion.
`web/src/api/identity.ts` is the pattern to copy for the API layer, and
`web/src/api/errors.ts` explains the 401/403 rule this form must honour; the comment at
[`navigation.ts:18-20`](../../web/src/app/navigation.ts) explains why client-side filtering is
never the reason a check can be skipped.

Backend tests are known to be failing as of 2 Aug, owned by a teammate and unrelated to this
work. Do not treat the suite as a gate for this ticket.
