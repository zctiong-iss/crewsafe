# ADR 0004 — AWS Cognito for authentication

**Status:** Accepted
**Date:** 2026-07-28

## Context

The backend must authenticate a React web app and a React Native worker app, enforce four
roles server-side (FR-02), and restrict each user to their assigned sites (FR-03). FR-01
specifies seeded project accounts and signed access tokens.

Authentication is outsourced to a managed identity provider rather than built in-house.
AWS Cognito issues tokens, stores credentials, and serves the Hosted UI login page; this
backend never sees a password.

## Decision

**Hosted UI, Authorization Code flow with PKCE.** Both clients (web, mobile) are public
app clients with no secret. Neither this backend nor either client ever calls
`InitiateAuth` with a username and password — a browser or app redirects to Cognito's own
login page, and returns with an authorization code it exchanges directly against
Cognito's token endpoint.

The backend becomes a **pure OAuth2 resource server**: it validates a token it is handed
against Cognito's JWKS, and does nothing else authentication-related. There is no
`/auth/login`, no `/auth/refresh`, and no password anywhere in its codebase.

**Roles and site membership stay entirely local.** `app_user.role` remains the single
source of truth for what kind of thing a user may do; `site_membership` remains the single
source of truth for which sites they may reach. No identity provider can answer either
question — they are facts about this project's data, not about who a user is — so both
stay local regardless of who issues the token. Keeping roles local also means a demotion
takes effect on the very next request rather than whenever a token happens to expire.

**A validly-signed token for an unknown `sub` is rejected, not provisioned.** Accounts are
administered (FR-01), not self-service — this project does not want a Cognito login
creating a roleless, siteless user that would fail every authorization check anyway.

## Rationale

**Why outsource authentication at all.** Login UI, credential storage, password reset and
MFA are commodity concerns with no connection to this project's actual value, which is in
the authorization layer — the join against `site_membership` that decides who may see
which site. An identity provider does not replace that work; it only replaces the
token-issuing half.

**Why Hosted UI over a backend-proxied login.** The alternative — clients keep calling a
`/auth/login` endpoint that itself calls Cognito's `InitiateAuth` — keeps a login endpoint
alive on this backend forever: `SECRET_HASH` computation, exception mapping, a rate
limiter in front of it, an AWS SDK dependency at runtime. None of that is graded, none of
it does anything Cognito doesn't already do better, and all of it is security-sensitive
code a human has to keep reading. Hosted UI removes that surface entirely — there is no
login code in this repository to read at all. The redirect and PKCE handling that remains
lives in `oidc-client-ts` (web) and `expo-auth-session` (mobile), established libraries
doing exactly what "outsource, don't rebuild" asks for, on the client side.

**Historical local-emulator decision (superseded for normal development by
[ADR 0006](0006-shared-remote-cognito-for-development.md)).**
[`jagregory/cognito-local`](https://github.com/jagregory/cognito-local) is a real
implementation of the Cognito Identity Provider HTTP API — genuine RS256 tokens, a genuine
JWKS endpoint. It was originally run alongside Postgres for normal local development.
ADR 0006 removed that runtime path; the pinned image and synthetic fixture now run only
through Testcontainers in automated tests. Two
Cognito-specific validation traps exist regardless of environment and are covered
explicitly: **`token_use`**, because an ID token and an access token share signing keys
and only this claim tells them apart; and **`client_id`**, because Cognito access tokens
carry no `aud` claim, so a token from an unrelated app client in the same pool would
otherwise be accepted.

**The accepted login-audit gap (FR-04).** Under Hosted UI, the credential check happens
entirely inside Cognito, off this backend's infrastructure — there is no login attempt
for the backend to see, successful or failed. The mitigation: the resource-server
converter that resolves a token's `sub` to a local user records `TOKEN_FIRST_SEEN` for the
first authenticated API call it sees with a given access token — the closest honest
substitute for "a login happened" that a pure resource server can observe, and named so
that it cannot be mistaken for one (see Consequences). A failed login attempt is not recoverable under any
design that outsources the credential check — Cognito's `PreAuthentication` trigger fires
*before* the password check, so even a Lambda trigger could not see a failure either.
Accounts here are seeded and not internet-facing, so the brute-force risk this leaves
uncovered is smaller than it would be for a public product.

**No MFA.** Out of scope for this project; noted here rather than left as a silent gap.

## Consequences

- The `cognitoidentityprovider` AWS SDK is test-scoped for the pinned emulator and is
  absent from the normal runtime classpath.
- A compromised refresh token can be revoked server-side via Cognito's
  `AdminUserGlobalSignOut` — a real improvement over the stateless-refresh-token design it
  replaces (ADR 0003), which had no revocation story at all.
- The backend's login-audit trail (FR-04) covers "authenticated and made an API call," not
  "attempted to log in" — an accepted, explicitly documented gap rather than an oversight.
- Automated tests depend on `cognito-local` staying a faithful emulator; normal
  development uses the shared deployed pool defined by ADR 0006.
  Its own limitations are tracked directly rather than assumed:
  - It supports only the `USER_PASSWORD_AUTH` flow — fine for minting tokens in tests,
    irrelevant to the real Hosted UI redirect, which only a real pool can exercise.
  - **It signs every user pool with one hardcoded keypair.** Against real Cognito each pool
    has its own keys, so a wrong-issuer token would fail the signature check anyway; under
    the emulator the two checks are genuinely independent. That is a weaker environment,
    but a more useful one for testing: a second pool in the same container yields a token
    with a valid signature and a wrong `iss`, which isolates `JwtIssuerValidator` exactly.
    `CognitoTokenValidationTest.tokenFromAnotherUserPoolIsRejectedByTheIssuerCheck` relies
    on this. Without it the issuer check — whose `issuer-uri` is configured independently
    of `jwk-set-uri` and could therefore drift silently — would have no coverage at all.
  - It persists issued refresh tokens into its own data directory, so the pinned synthetic
    fixture under `backend/src/test/resources/` is copied into the Testcontainers instance
    at startup rather than mounted from normal local Compose.

- **The audit write on the authentication path fails open.** `TOKEN_FIRST_SEEN` is recorded
  from the JWT converter, which runs inside an authentication filter that only knows how to
  turn `AuthenticationException` into a 401 — so a `DataAccessException` from the audit
  insert would surface as a 500 on the first request of every token. That record is
  observability, not an authorization decision, so it is logged at ERROR and swallowed
  rather than being allowed to take the API down. `ACCESS_DENIED` in `SiteAccessEvaluator`
  is a security decision and is deliberately *not* treated this way.

- **`TOKEN_FIRST_SEEN` counts tokens, not logins.** Web access tokens live 15 minutes, so
  one working day of silent refresh produces roughly thirty rows for a single human login.
  The constant is named for what it actually records rather than `LOGIN_SUCCESS`, so that
  nobody reading the table later mistakes the multiplier for a login count. It is also
  per-instance in-memory state, cleared when it reaches 10,000 entries, so the count can
  additionally over-report across restarts and instances. Accepted: FR-04 asks for an audit
  trail, not for billing-grade session accounting.

- **No application-level rate limiting anywhere in the system.** The login rate limiter was
  deleted with the login endpoint, and deliberately not replaced: credential stuffing is now
  Cognito's problem, and it throttles its own Hosted UI. General API throttling is left to
  the edge (ALB / API Gateway) rather than reimplemented per-instance in application memory,
  where it would not hold across replicas anyway. Recorded here so the gap is a decision
  rather than an omission.

## Related

- [ADR 0002 — Cookie-free bearer authentication](0002-cookie-free-bearer-authentication.md) — still holds; tokens still arrive as `Authorization: Bearer`, never a cookie.
- [ADR 0001 — Spring Security with self-issued JWTs](0001-spring-security-with-self-issued-jwts.md) — superseded by this ADR.
- [ADR 0003 — Stateless refresh tokens](0003-stateless-refresh-tokens.md) — superseded by this ADR.
