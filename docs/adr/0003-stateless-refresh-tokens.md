# ADR 0003 — Stateless refresh tokens

**Status:** Accepted, with a documented limitation
**Date:** 2026-07-28

## Context

FR-01 requires short-lived signed access tokens. A 15-minute token satisfies that but
cannot carry a worker through an eight-hour outdoor shift — the reference project has no
refresh mechanism at all, so its users simply log in again.

Three options were considered:

1. Access token + opaque refresh token stored hashed in the database, rotating and revocable
2. Access token + refresh token that is itself a JWT, with no server-side record
3. A single long-lived access token

## Decision

Option 2. A 15-minute access JWT and a 7-day refresh JWT, both signed with the same key and
distinguished by a `typ` claim. No `refresh_token` table.

This was chosen by the project owner with the revocation trade-off stated explicitly.

## Rationale

- No extra table, no rotation bookkeeping, no cleanup job — meaningful in a four-week build.
- Access tokens stay genuinely short-lived, so FR-01 is satisfied.
- Users log in roughly once a week rather than every 15 minutes.

## Consequences

### The limitation

**Logout is client-side only. A stolen refresh token remains valid until it expires and
cannot be revoked server-side.** There is no record to invalidate.

This belongs in the security report as an accepted risk, not an oversight.

### What reduces the exposure

- Access tokens last 15 minutes.
- Refreshing rotates both tokens, limiting how long a leaked token stays *useful* in
  practice — though it is not revocation.
- Account status is re-read from the database on every request, so a **deactivated user is
  locked out immediately**, including at the refresh endpoint. Deactivation is therefore the
  effective response to a compromised account.
- Roles are likewise re-read per request, so privilege changes apply at once.

### The critical implementation detail

Both token types are signed with the same key, so a `typ` claim is checked on every parse:
`typ=access` in the authentication filter, `typ=refresh` at the refresh endpoint. **Without
this check a 7-day refresh token would function as a 7-day API key.**

Covered by dedicated tests at both the unit level (`JwtServiceTest`) and over HTTP
(`AuthControllerTest.refreshTokenIsRejectedAsAnAccessTokenOnProtectedEndpoints`).

### Upgrade path

Every token already carries a `jti`. If revocation becomes necessary: add a `revoked_jti`
table, write to it on logout, and check it at the refresh endpoint. No restructuring, and
the claim needed is already being issued.

## Related

- [ADR 0002 — Cookie-free bearer authentication](0002-cookie-free-bearer-authentication.md)
