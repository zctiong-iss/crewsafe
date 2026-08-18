# ADR 0018 — Backend-provisioned Cognito accounts for admin-registered users

**Status:** Accepted
**Date:** 2026-08-17

## Context

The admin console (US-30) lets an ADMIN register a local `app_user` row. Its first phase
only bound an already-existing Cognito identity — the admin still had to create that
identity out-of-band (AWS Console, or the SCRUM-190 CI pipeline for synthetic identities)
and paste in its `cognitoSub`.

`POST /api/v1/admin/users` now accepts an `email` and a `password` and has the backend call
Cognito's `AdminCreateUser` directly — `com.crewsafe.admin.cognito.CognitoUserProvisioningService`.
The admin types the password; Cognito's auto-generate-and-email flow is not used
(`MessageAction=SUPPRESS`). This project's accounts are seeded under the reserved
`@synthetic.crewsafe.invalid` domain, which cannot receive real mail, so an emailed invite
was never a workable path here — a simple admin-typed password is the pragmatic choice for
what this project actually is.

## Decision

**The backend gains a narrow, dedicated Cognito-admin capability**, isolated to one class
(`CognitoUserProvisioningService`) and one IAM statement (`ProvisionInvitedUserAccounts` on
`aws_iam_role.task` in `infra/terraform/secrets/main.tf`), scoped to exactly
`cognito-idp:AdminCreateUser` against the one Cognito user pool ARN — no
`AdminSetUserPassword`, no `AdminResetUserPassword`, no group actions, nothing the existing
`aws_iam_role.cognito_admin` (GitHub-OIDC-only, SCRUM-190's CI pipeline) already holds for
its own unrelated purpose. `AdminGetUser` is not granted either — the created user's `sub`
comes back in the `AdminCreateUser` response itself.

**Decoupled from a code deploy.** `CognitoAdminProperties` is deliberately not
`@Validated`/`@NotBlank` — the SSM parameter and IAM grant this needs are applied by a
separate Terraform step, so requiring either at Spring Boot startup would crash the whole
application during the window between a code deploy and that Terraform being applied. The
service checks for a non-blank `userPoolId` itself and fails one request cleanly (409,
`ErrorCode.COGNITO_PROVISIONING_DISABLED`) rather than the app failing to boot. There is no
separate `enabled` toggle: the pool id is already blank until the Terraform runs and a real
id once it does, so it is the one signal, applied automatically rather than a manual flag
someone has to remember to flip.

**The password is validated against the pool's own policy** (12+ chars, upper/lower/digit/
symbol) before the AWS call, so a weak password fails with a clear 400 instead of a raw
Cognito `InvalidPasswordException`. No daily quota is enforced — Cognito's own email quota,
the thing an earlier draft of this ADR sized a rate limit around, is moot once
`MessageAction=SUPPRESS` means no email is ever sent.

## Consequences

This amends **ADR 0004**'s Consequences: *"the backend never sees a password"* is no longer
true on this one path — the admin types a `TemporaryPassword` that this backend passes
straight to `AdminCreateUser`. Deliberate, not an oversight: this is an admin provisioning an
account for someone else, the same pattern most admin panels use, not a user's own login
credential. The login path itself (Hosted UI) is untouched by this ADR and still never sees a
password.

Also amends: *"The `cognitoidentityprovider` AWS SDK is test-scoped for the pinned emulator
and is absent from the normal runtime classpath."* — no longer true. The dependency in
`backend/pom.xml` is now compile-scoped; `CognitoUserProvisioningService` is a genuine
runtime caller of the Cognito admin API, not a test-only concern.

Other consequences:

- The backend's task role (`aws_iam_role.task`) now holds a real, if narrow, Cognito-admin
  capability it didn't have before — reviewed and scoped in this ADR rather than added
  quietly alongside an unrelated feature.
- Registering a user by binding an already-existing `cognitoSub` (Phase 1's path) is
  unchanged and still the right tool for SCRUM-190 synthetic identities — this ADR adds a
  second path, it does not replace the first.

## Related

- [ADR 0004 — AWS Cognito for authentication](0004-aws-cognito-for-authentication.md) —
  amended by this ADR, as described above.
- [ADR 0006 — Shared remote Cognito for development](0006-shared-remote-cognito-for-development.md) —
  still the source of truth for the CI-driven synthetic-identity pipeline this ADR's new
  path is deliberately separate from.
