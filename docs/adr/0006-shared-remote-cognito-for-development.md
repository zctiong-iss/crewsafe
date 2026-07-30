# ADR 0006 — Shared remote Cognito for development

**Status:** Accepted
**Date:** 2026-07-30
**Jira:** SCRUM-154

## Context

The local Cognito emulator cannot exercise Cognito managed login. Other
developers must test application code against the same deployed identity
boundary without running Terraform or holding AWS credentials.

## Decision

Normal development uses one deletion-protected `crewsafe-shared-dev` Cognito
pool deployed by reviewed GitHub Actions Terraform plans. Developers obtain
only non-sensitive pool/client identifiers and synthetic application mappings
from `CREWSAFE_SHARED_COGNITO_JSON` through authenticated GitHub CLI.

The pinned `cognito-local` container remains test-only in Testcontainers for
deterministic token, issuer, client, and authorization tests. It is not started
by `run.sh` or Compose.

Initial user creation is a single AWS Console action because it is the only
step receiving an email. Invitations remain valid for 30 days. Resend is an
exceptional Console recovery action because Cognito implements it with
`AdminCreateUser`; granting that permission to GitHub would also grant broad
creation authority. All supported non-PII lifecycle and group operations use a
main-only, actor-allowlisted GitHub workflow.

## Consequences

- No developer runs Terraform locally or configures an AWS profile.
- Shared-development availability now depends on GitHub and AWS; local fallback
  may not mutate identity or infrastructure.
- CrewSafe PostgreSQL remains authoritative for role, site, and immediate
  revocation.
- Email, passwords, tokens, state, and saved plans remain outside repository
  configuration and logs.
- ADR 0004 still governs Hosted UI, PKCE, token validation, and server-side
  authorization; only its normal-local-runtime decision is superseded.

## Alternatives

- Normal local Cognito: rejected because it cannot validate managed login.
- Terraform-managed users: rejected because mutable identity data and
  credentials can enter state.
- GitHub `AdminCreateUser`: rejected because IAM cannot separate creation from
  invitation resend.
