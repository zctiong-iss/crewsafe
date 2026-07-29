# ADR 0005 — Browser token storage

**Status:** Accepted
**Date:** 2026-07-29

## Context

The web app is a public OAuth2 client. It obtains tokens through Authorization Code +
PKCE against Cognito's Hosted UI (ADR 0004) and must hold an access token to call the API.
There are no cookies anywhere in this system (ADR 0002), so the browser has to keep the
token somewhere JavaScript can reach — and anything JavaScript can reach, injected
JavaScript can also reach.

Three options were considered.

| | Survives page refresh | Shared across tabs | Readable by injected script |
|---|---|---|---|
| `localStorage` | Yes | Yes | Yes |
| `sessionStorage` | Yes, same tab only | No | Yes |
| In-memory only | **No** | No | Yes, while the page lives |

## Decision

**`sessionStorage`**, for both the user store and the PKCE state store.

In-memory storage is the strongest of the three, but it logs the user out on every page
refresh. CrewSafe is an operations console used through an eight-hour shift, often on a
phone on patchy site data; a refresh that forces a fresh trip through the Hosted UI is a
real cost paid many times a day, against an attack that requires script injection to
exploit at all.

`localStorage` is rejected outright. It buys only cross-tab sessions, and it pays for them
by keeping a live session on a shared or unattended machine after the tab is closed —
exactly the situation a site office produces.

## Consequences

- **An XSS vulnerability in this app yields a valid access token.** That is true of all
  three options while the page is open; `sessionStorage` narrows the window to one tab and
  ends it when the tab closes. The mitigations that actually matter are therefore the ones
  that prevent injection: the strict CSP the API already serves, React's default escaping,
  and never introducing `dangerouslySetInnerHTML`.
- The blast radius is bounded by the 15-minute access token from ADR 0004. A stolen token
  expires quickly; a stolen *refresh* token is the more serious loss, and it is revocable
  server-side via `AdminUserGlobalSignOut`.
- Closing the tab ends the session. This is intended, not a bug to be "fixed" later by
  moving to `localStorage`.
- The choice is asserted in a test (`tokenStorage.test.ts`) rather than left to review.
  Switching to `localStorage` is a one-word change that looks harmless in a diff, and most
  `oidc-client-ts` examples online use it.

## Alternatives not taken

**A backend-for-frontend holding tokens in an HttpOnly cookie.** This is the genuinely
stronger design: the token never reaches JavaScript at all. It was rejected because it
reintroduces the server-side session and CSRF surface that ADR 0002 removed, and it means
building and operating a second service whose only job is to proxy. Worth revisiting if
this ever handles real worker data rather than synthetic demo data.

## Related

- [ADR 0002 — Cookie-free bearer authentication](0002-cookie-free-bearer-authentication.md) — why there is no cookie to put a token in.
- [ADR 0004 — AWS Cognito for authentication](0004-aws-cognito-for-authentication.md) — where the tokens come from and how long they live.
