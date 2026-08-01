# ADR 0009 — Accept react-router-dom 6.30.4, defer the v7 migration

**Status:** Accepted
**Date:** 2026-08-01

## Context

`npm audit` in `web/` reports two moderate findings, both tracing to one production
dependency: `react-router-dom@6.30.4`, pinned exactly at `web/package.json`.

| Advisory | Mechanism | Affected range |
|---|---|---|
| [GHSA-jjmj-jmhj-qwj2](https://github.com/advisories/GHSA-jjmj-jmhj-qwj2) | Open redirect leading to XSS | `>=6.30.2 <=6.30.4` |
| [GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6) | Open redirect via backslash in `<Link>` / `useNavigate` | `>=6.0.0 <7.18.0` |
| [GHSA-337j-9hxr-rhxg](https://github.com/advisories/GHSA-337j-9hxr-rhxg) | Arbitrary constructor injection in `deserializeErrors()` during SSR hydration | `>=6.4.0 <7.18.0` |

Two facts shape the decision. **`6.30.4` is the final 6.x release** — the line is closed, so
no patch is coming. And the only remediation npm offers is `7.18.2`, which it reports as
`isSemVerMajor: true`; v6 → v7 changes the router API this application is built on.

This matters more here than the "moderate" label suggests. [ADR 0005](0005-browser-token-storage.md)
accepts that an XSS in this app yields a valid access token from `sessionStorage`, and names
injection-prevention as the mitigation that actually carries the weight. An advisory whose
end state is XSS is therefore squarely in the class this system cannot be relaxed about.

## Decision

**Stay on `6.30.4` for Sprint 1. Do not run `npm audit fix --force`.**

The advisories are not reachable in this codebase. Both open-redirect findings require a path
from untrusted input to a navigation target, and no such path exists — every navigation
destination in `web/src` is a compile-time literal:

| Site | Target |
|---|---|
| `app/App.tsx` | `<Navigate to="/" replace />` |
| `auth/CallbackPage.tsx` (×2) | `navigate("/", { replace: true })` |
| `components/AppShell.tsx` | `to={item.to}`, from the five literals in `app/navigation.ts` |

Nothing in `web/src` calls `useSearchParams` or reads `location.search`, and
`app/navigation.ts` references no external input. The third advisory is inapplicable
outright: this is a client-only SPA on `BrowserRouter`, with no server-side hydration.

Upgrading a routing library mid-sprint, to fix findings the application cannot reach, spends
the sprint's remaining capacity on risk that does not exist yet — while introducing real risk
in code that currently works.

## Consequences

- **`npm audit` will continue to report two moderate findings, and CI dependency scanning
  will flag them.** This record is the answer to that finding; it is not a silent exception.
- **The non-exposure claim is a property of today's routing code, not of the library.** It
  must be re-checked whenever navigation changes. The specific tripwire: **a `redirect`,
  `returnTo`, or `next` query parameter** — the ordinary "send me back where I was after
  login" feature, and a natural next step for an app with a Cognito callback screen. Adding
  one makes both open-redirect advisories live and promotes the migration to urgent.
- The v7 migration becomes a scheduled backlog story rather than an emergency, sized against
  the v6 → v7 data-router API change and planned for after Sprint 1.
- Because the line is closed, this dependency will accrue further advisories with no patch
  path. Every future `npm audit` finding on `react-router-dom` resolves to the same
  migration, which strengthens the case for scheduling it early in Sprint 2.

## Alternatives

- **Upgrade to `7.18.2` now.** Rejected: a breaking major, mid-sprint, against advisories
  this application demonstrably cannot reach. It is the correct eventual action, taken at the
  wrong moment.
- **Patch on the 6.x line.** Not available. `6.30.4` is the last release; there is no
  `6.30.5` and there will not be one.
- **`npm audit fix --force`.** Rejected as a mechanism, independent of the target version: it
  applies semver-major upgrades without review, which is how a routing library gets replaced
  in a commit nobody read.
- **Replace `react-router-dom` with another router.** Disproportionate to the finding, and it
  would discard the navigation model in `app/navigation.ts`.

## Related

- [ADR 0005 — Browser token storage](0005-browser-token-storage.md) — why an XSS-class
  advisory is weighted heavily in this application, and which mitigations carry the load.
- [ADR 0004 — AWS Cognito for authentication](0004-aws-cognito-for-authentication.md) — the
  redirect flow that a future `returnTo` parameter would most likely be added to.
- ADR 0007 (Recharts over Chart.js) and ADR 0008 (no component library in Sprint 1) are
  reserved and not yet written.
