# ADR 0011 — Inline-expand shift list over a `/shifts/:id` detail route

**Status:** Accepted
**Date:** 2026-08-04

## Context

SCRUM-161 Part 2 adds the shifts list at [`/shifts`](../../web/src/app/App.tsx). Each shift
has assignments — a supervisor needs to see *who is on this shift, at what intensity, on what
task* — so the list needs a way to drill from a shift into its crew.

[ADR 0010](0010-flat-routing-site-scoped-screens.md) already settled the routing shape for the
create-shift screen: **flat, with no user-editable object reference concatenated into a request
path.** This ticket forces the same question one level down — how do you reveal a *single
shift's* detail — and the answer must not quietly undo 0010.

Two shapes were on the table:

| | Inline-expand (`/shifts` only) | Detail route (`/shifts/:id`) |
|---|---|---|
| Shift id source | never in a URL — it's the object already in the list's state | `useParams()`, user-editable in the address bar |
| Extra network call to open | None — assignments are already loaded | A fetch keyed by the URL's `:id` |
| Deep-linkable to one shift | No | Yes |
| Reintroduces the CSPT/BOLA surface 0010 removed | No | **Yes** |

The list payload already carries what a detail view needs: [`Shift.assignments`](../../web/src/api/shifts.ts)
is part of the `GET /api/v1/sites/{siteId}/shifts` response, so expansion is a pure client-side
state toggle, not a second round trip.

## Decision

**Inline-expand.** Each shift renders as a card; a disclosure control expands it **in place** to
list that shift's assignments. **No shift id ever appears in a URL or is concatenated into a
front-end request path from the address bar.**

This is the same principle as 0010, applied to reads. A `/shifts/:id` route would flow `:id`
from `useParams()` straight into `apiFetch(`/api/v1/…/${id}`)` — the exact client-side
path-traversal (CSPT) and object-enumeration (BOLA) surface 0010 removed *by construction*.
Inline expansion sources the shift from data already in component state
([`ShiftList.tsx`](../../web/src/features/shifts/ShiftList.tsx)), so there is no attacker-controlled
segment to traverse and nothing to enumerate in the address bar.

As in 0010: **routing shape is not the security boundary** — `ShiftService` authorises every
request server-side regardless of URL. Inline-expand is chosen for **defense-in-depth and
architecture fit** (it keeps every site-scoped screen flat and `siteId` server-sourced), not
because it is the control.

## Consequences

- **No per-shift deep link.** A supervisor cannot bookmark or share a link to one shift.
  Acceptable now — the list is short and single-site — and it becomes a real limitation only
  when a genuine detail view is needed (editing a shift, per-worker acknowledgements).
- **The list endpoint must keep returning assignments.** Expansion depends on
  `Shift.assignments` being present in the list payload. If that ever slims to a summary, the
  expand path needs rethinking (and that is the moment to reconsider this ADR, not before).
- **Worker names are joined client-side.** Assignments carry `workerId`, not a name;
  `ShiftList` runs `Promise.all([fetchSiteShifts, fetchSiteWorkers])` and joins them. A
  `workerId` absent from the workers list falls back to a visible placeholder rather than being
  hidden — on a safety console, silently dropping an assigned worker is the worse failure.
- **Revisit trigger, explicit.** When a real single-shift view arrives (edit, or a longer list
  that shouldn't ship all assignments up front), reopen this. The correct nested design at that
  point pairs `/shifts/:id` with a **UUID-format guard on the param before it reaches any
  request path** — the same mitigation 0010 named and deferred to SCRUM-134.
- **Server-side authorization remains the control.** This reduces surface; it does not replace
  `ShiftService`'s object-level checks.

## Alternatives

- **`/shifts/:id` detail route.** Rejected for now. Deep-linkable, but reintroduces a
  user-editable path segment sourced from the URL — the CSPT/BOLA surface 0010 removed — to buy
  per-shift links nothing in this ticket needs.
- **`/shifts/:id` with a UUID-format guard.** The security-adequate version of the detail route:
  reject anything that is not a well-formed UUID before it reaches `apiFetch`. Rejected as
  premature — same reasoning as 0010: it puts a validation obligation on a screen for
  deep-linking no current screen uses. Adopt it *with* the story that needs it.
- **Modal fetched by shift id.** A detail modal that fetches `GET /api/v1/.../shifts/{id}` on
  open. Rejected — it still concatenates an id into a request path (the same sink as the route,
  minus the URL) and adds a network call for data already in hand.

## Related

- [ADR 0010 — Flat routing for site-scoped screens](0010-flat-routing-site-scoped-screens.md) —
  the rule this extends from writes (the create form) to reads (the list).
- [ADR 0005 — Browser token storage](0005-browser-token-storage.md) — why injection-class risks
  like CSPT are weighted heavily in this app: the bearer token rides any request the SPA issues.
- [SCRUM-161 plan](../plans/SCRUM-161-create-shift-form-plan.md) — the ticket this list ships under.
- SCRUM-134 (multi-site view) — the story likely to reopen this and move detail to
  nested-with-guard.
