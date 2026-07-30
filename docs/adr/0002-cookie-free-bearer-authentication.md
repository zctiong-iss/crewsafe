# ADR 0002 — Cookie-free bearer authentication

**Status:** Accepted
**Date:** 2026-07-28

## Context

The reference project `ca_laps_team4` runs two security filter chains: a stateless one for
`/api/**`, and a session-based one with form login and a CSRF cookie for its server-rendered
Thymeleaf pages. It also exposes `GET /auth/jwt`, which exchanges a `JSESSIONID` for a JWT.

CrewSafe serves only JSON, to a React web app and a React Native app. It has no
server-rendered pages.

Notably, that project's own Angular frontend already authenticates without cookies —
`sessionStorage` plus an `Authorization: Bearer` header, no `withCredentials`. The cookie
machinery exists solely for the server-rendered half.

## Decision

One stateless filter chain. Authentication comes exclusively from an
`Authorization: Bearer` header. No session is created, no cookie is set or read, and CSRF
protection is disabled.

## Rationale

- **CSRF protects cookies.** The attack works because browsers attach cookies automatically
  based on destination, not intent. An `Authorization` header is never attached
  automatically, and the same-origin policy prevents a hostile page reading the token. With
  no ambient credential there is nothing to forge — CSRF tokens would be ceremony.
- **CORS gets stricter.** `allowCredentials(false)` is a tighter policy than the
  credentialed alternative.
- **React Native has no usable cookie jar.** A cookie design would still need a Bearer path
  for mobile, leaving two authentication mechanisms to secure instead of one.
- **No server-side session state** to size, share or scale across Fargate tasks.

## Consequences

- **XSS exposure.** A token in JavaScript-reachable storage can be read by injected script,
  where an `HttpOnly` cookie could not. This is the real cost and is accepted.
  - Mitigations: `Content-Security-Policy` header; React's default escaping with no
    `dangerouslySetInnerHTML` on server data; 15-minute access tokens;
    `expo-secure-store` (iOS Keychain / Android Keystore) on mobile.
  - Optional hardening if a review requires it: hold the access token in memory only and
    persist just the refresh token, capping an XSS payload's reach at 15 minutes.
- Clients must attach the header themselves; there is no automatic browser behaviour to
  lean on.
- The property is enforced by tests — `SecurityChainTest` asserts no `Set-Cookie` on any
  response, so re-enabling sessions fails the build.

## Related

- [ADR 0001 — Spring Security with self-issued JWTs](0001-spring-security-with-self-issued-jwts.md)
- [ADR 0004 — AWS Cognito for authentication](0004-aws-cognito-for-authentication.md) — still holds under Cognito; tokens still arrive as `Authorization: Bearer`
