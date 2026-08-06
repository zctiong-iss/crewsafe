# ADR 0015 — Flat routing for site-scoped screens; resolve `siteId` server-side

**Status:** Accepted
**Date:** 2026-08-03

## Context

SCRUM-161 adds the first site-scoped screen, the create-shift form. It needs a `siteId` to
call `POST /api/v1/sites/{siteId}/shifts`. Every route in [`App.tsx`](../../web/src/app/App.tsx)
is flat today — `/shifts`, `/approvals` — with no `siteId` in any URL. This ticket forces the
choice for every site-scoped screen that follows it, because whoever builds the next one
inherits the pattern (recorded as **D-1** in the [SCRUM-161 plan](../plans/SCRUM-161-create-shift-form-plan.md)).

Two shapes were on the table:

| | Flat (`/shifts/new`) | Nested (`/sites/:siteId/shifts/new`) |
|---|---|---|
| `siteId` source | `GET /api/v1/me`, server-issued | `useParams()`, user-editable in the address bar |
| Deep-linkable per site | No | Yes |
| Multi-site (SCRUM-134) | Needs a "current site" selector | URL carries the context |
| Matches existing routes | Yes | No |

The form itself is unaffected either way: it takes `siteId` as a prop, so routing wraps around
it without editing the component.

## Decision

**Flat. `/shifts/new`, with `siteId` resolved server-side from `GET /api/v1/me`** — no site
identifier appears in any URL, and no user-editable value is concatenated into the front-end's
API request path.

**Routing shape is not a security control**, and this decision does not pretend it is. The same
principle governs it as [`navigation.ts:18`](../../web/src/app/navigation.ts) — hiding a link is
not a control — and the invariant already stated in the plan: every rule the client enforces,
`ShiftService` enforces again, and a cross-site `POST` is rejected with 403 (**AC-4**) whatever
the URL looks like. An attacker can craft `POST /api/v1/sites/{any}/shifts` with `curl`
regardless of what the SPA's address bar shows. Flat is therefore chosen for **defense-in-depth
and architecture fit**, not because it is the boundary — the boundary is server-side object
authorization, and it holds under either shape.

What flat *does* remove is a front-end attack surface that nested creates:

- **Client-side path traversal (CSPT) — the deciding factor.** Under nested, `:siteId` flows
  from `useParams()` straight into `apiFetch(`/api/v1/sites/${siteId}/shifts`)`. A crafted value
  carrying `../` or its encoding (`%2e%2e%2f`) can rewrite *which endpoint the browser calls* —
  and the request leaves the victim's own authenticated session, so the bearer token attached by
  [`client.ts`](../../web/src/api/client.ts) rides along automatically. Aimed at a state-changing
  "gadget" endpoint, that turns a mistargeted read into an action taken *as the victim*. Flat
  sources `siteId` from `/api/v1/me`, so no attacker-controlled segment is concatenated into the
  request path in the first place — the class is removed **by construction**, not by remembering
  to validate the param on every screen.
- **Broken object-level authorization (BOLA / enumeration).** Nested puts an editable object
  reference in the address bar, inviting a legitimate-but-limited user to try a neighbouring
  site. Opaque UUID site ids already make walking the space impractical and the server returns
  403, but flat closes the typed-URL path outright.

## Consequences

- **`CreateShiftPage` resolves the site from the already-loaded auth context, not a fresh
  fetch.** `useCurrentUser().siteIds` reads the `CurrentUser` that `AuthProvider` loaded once at
  sign-in ([`AuthProvider.tsx:89`](../../web/src/auth/AuthProvider.tsx)) — the same context
  `HomePage` and `AppShell` already read. Flat therefore adds **no** runtime network call. A
  multi-site user needs a site selector here; deferred to SCRUM-134, with `siteIds[0]` the
  single-site path.
- **Test-harness consequence — and not flat-specific.** Rendering the form mounts `<AppShell>`,
  which calls `useCurrentUser()` and throws outside a signed-in context. Form tests must supply
  one: inject a mock `AuthContext` value, or wrap in `<AuthProvider userManager={fakeUserManager({})}>`
  (as [`authStates.test.tsx`](../../web/src/auth/authStates.test.tsx) does), which fetches
  `/api/v1/me` at mount and so needs a `/api/v1/me` MSW handler returning a signed-in
  `CurrentUser`. This comes from `AppShell`, so it holds under nested too — a cost of the screen,
  not of this decision.
- **No per-site deep links.** A supervisor cannot bookmark or share a link to a specific site's
  create-shift screen. Acceptable while a user is effectively single-site; it becomes a real
  limitation at **SCRUM-134's multi-site view**.
- **Revisit trigger, explicit.** When a user legitimately operates across multiple sites and
  needs to link into a specific one, reopen this. The correct nested design at that point pairs
  the route with a **UUID-format guard on the param before it reaches any request path** — the
  mitigation this ADR avoids needing today.
- **Server-side authorization remains the control.** This decision reduces surface; it does not
  substitute for `ShiftService`'s 403. AC-4 must keep passing under any future routing change.

## Alternatives

- **Nested (`/sites/:siteId/shifts/new`).** Rejected for now. Deep-linkable and scales to
  SCRUM-134, but sources a user-editable path segment from the URL — the CSPT and enumeration
  surface above — to buy per-site links nothing in this ticket needs.
- **Nested with a UUID-format guard on `:siteId`.** The security-adequate version of nested:
  reject anything that is not a well-formed UUID before it reaches `apiFetch`. Rejected as
  premature — it puts a validation obligation on every site-scoped screen for deep-linking no
  current screen uses. It is the right design to adopt *with* SCRUM-134, not ahead of it.
- **Nested returning 404 instead of 403 for a non-member site.** Would hide resource existence,
  but conflicts with the 401/403 contract in [`errors.ts`](../../web/src/api/errors.ts) that
  AC-4 depends on, and UUID ids already make the existence leak academic.

## Related

- [ADR 0005 — Browser token storage](0005-browser-token-storage.md) — why injection-class risks
  (CSPT is one) are weighted heavily in this app, and why the mitigations that carry the load are
  the ones that stop attacker-controlled input reaching a sensitive sink.
- [ADR 0009 — react-router-dom advisories](0009-react-router-6-advisories.md) — the same tripwire
  family: untrusted input reaching a navigation/URL target. A `returnTo`/`redirect` param there,
  a `:siteId` path segment here.
- [SCRUM-161 plan](../plans/SCRUM-161-create-shift-form-plan.md) — the D-1 open decision this ADR
  settles.
- SCRUM-134 (multi-site view) — the story that will reopen this and likely move it to
  nested-with-guard.
