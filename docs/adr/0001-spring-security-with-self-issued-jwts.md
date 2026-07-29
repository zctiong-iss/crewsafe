# ADR 0001 — Spring Security with self-issued JWTs

**Status:** Superseded by [ADR 0004 — AWS Cognito for authentication](0004-aws-cognito-for-authentication.md)
**Date:** 2026-07-28

## Context

The backend must authenticate a React web app and a React Native worker app, enforce four
roles server-side (FR-02), and restrict each user to their assigned sites (FR-03). FR-01
specifies seeded project accounts and signed access tokens.

A managed identity provider (AWS Cognito) was considered. The project plan's cloud section
lists AWS Amplify Hosting for the web tier, which was initially mistaken for a Cognito
dependency; a search of the plan, the deliverables and the full git history found **no
reference to Cognito anywhere**. Every artifact specifies Spring Security with JWT.

## Decision

Authenticate with Spring Security, issuing and validating our own HS256 JWTs via JJWT.

## Rationale

- **Scope.** All identities are synthetic and seeded (FR-01, §4.4). Cognito's value — hosted
  UI, MFA, federation, password reset, user lifecycle — is entirely outside project scope,
  which explicitly excludes real deployment.
- **Local development and CI.** Cognito has no local emulator. Every developer and every CI
  run would need real AWS user pools or a mock, working against US-22/US-27 (tests and scans
  on every PR) and the Testcontainers-based integration layer.
- **The hard part is ours regardless.** FR-03 is a join against `site_membership`. No
  identity provider can answer it, so that code exists either way; Cognito would only
  replace the token-issuing half.
- **Assessable work.** Each team member must explain their implementation. A working RBAC
  and object-level authorization implementation demonstrates more than service configuration.

## Consequences

- We own token lifetime, signing-key management and validation. Mitigated by pinning HS256,
  refusing to start without `JWT_SECRET`, and 12 unit tests on `JwtService`.
- No MFA. Out of scope; note it in the security report.
- Migration to a managed provider stays open: tokens are standards-compliant, so swapping in
  a resource-server issuer URI and deleting our token endpoint is the whole change.

## Superseded

Replaced by [ADR 0004 — AWS Cognito for authentication](0004-aws-cognito-for-authentication.md).
The "migration to a managed provider stays open" consequence above turned out to be
accurate: the swap was exercised while this project had zero production usage and zero
external clients, so the whole self-issued-JWT design described here — `JwtService`,
`JwtAuthenticationFilter`, `AuthController`, BCrypt password storage, all of it — was
removed outright rather than kept alongside a new path.

## Related

- [ADR 0002 — Cookie-free bearer authentication](0002-cookie-free-bearer-authentication.md)
- [ADR 0003 — Stateless refresh tokens](0003-stateless-refresh-tokens.md)
