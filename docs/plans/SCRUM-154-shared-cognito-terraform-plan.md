# SCRUM-154 — Shared Cognito with Extensible Terraform CI/CD

## Summary

Provision one deployed `shared-dev` Cognito environment in a teammate-owned AWS
account. Developers use this shared AWS Cognito instance instead of running
Cognito locally.

Maintain exactly three repository-wide Terraform workflows:

1. Terraform Validation
2. Terraform Plan
3. Terraform Apply

SCRUM-154 and future Jira infrastructure work add Terraform roots and catalog
entries—not additional workflows.

User lifecycle operations use one separate, reusable Cognito administration
workflow. It is not a Terraform workflow and does not change the three-workflow
Terraform architecture.

The implementation is incomplete until
[`docs/runbooks/SCRUM-154-shared-cognito.md`](../runbooks/SCRUM-154-shared-cognito.md)
is created and verified by another developer.

## Generic Terraform Workflow Architecture

### Component catalog

Create `.github/terraform/components.json` as the allowlisted source of truth:

```json
{
  "state-backend": {
    "jira_key": "SCRUM-155",
    "root": "infra/terraform/bootstrap/state",
    "backend_strategy": "self-bootstrap",
    "state_key": "crewsafe/bootstrap/terraform.tfstate",
    "allow_destroy": false
  },
  "cognito-shared-dev": {
    "jira_key": "SCRUM-154",
    "root": "infra/terraform/cognito",
    "backend_strategy": "remote",
    "state_key": "crewsafe/cognito/shared-dev.tfstate",
    "allow_destroy": true
  }
}
```

Future Jira issues register their root, Jira key, backend strategy, state key and
destroy policy here.

Add a resolver that:

- rejects unknown components and path traversal;
- permits roots only under `infra/terraform/`;
- validates unique state keys;
- verifies the root and dependency lock exist;
- returns only catalog-controlled paths and settings;
- prevents workflow inputs from supplying arbitrary commands, paths or variable
  files.

### Repository-wide workflows

Rename/generalize the existing workflows:

- `terraform-state-validate.yml` → `terraform-validate.yml`
- `terraform-state-plan.yml` → `terraform-plan.yml`
- `terraform-state-apply.yml` → `terraform-apply.yml`

Delete the old state-specific workflows after migration.

Validation:

- runs automatically only for pull requests and pushes to `main` that change
  Terraform-related paths;
- discovers registered roots from the component catalog;
- runs formatting, initialization without a real backend, validation and mocked
  tests as a matrix;
- runs workflow lint, secret scanning, Terraform security scanning and catalog
  guard tests;
- receives no AWS credentials or OIDC permission.

Use this narrow path contract for automatic validation:

```yaml
on:
  pull_request:
    paths:
      - "infra/terraform/**"
      - ".github/terraform/**"
      - ".github/scripts/terraform/**"
      - ".github/workflows/terraform-*.yml"
  push:
    branches:
      - main
    paths:
      - "infra/terraform/**"
      - ".github/terraform/**"
      - ".github/scripts/terraform/**"
      - ".github/workflows/terraform-*.yml"
```

Move Terraform-only helper and guard scripts from `.github/scripts/` into
`.github/scripts/terraform/` so the path filter remains precise. Do not include
application source, local Compose, documentation, Spec Kit files or unrelated
GitHub automation in the Terraform validation trigger.

The path contract is maintained centrally in `terraform-validate.yml`. Adding a
new deployable root anywhere under `infra/terraform/` requires a component
catalog entry but no trigger change. If repository rules mark Terraform
validation as a required check, scope that rule to Terraform-related changes;
otherwise a GitHub workflow skipped by path filtering must not block unrelated
application pull requests.

Plan inputs:

- `target_account_alias`
- `terraform_component`
- `operation`: `apply` or `destroy`

Apply inputs:

- same alias, component and operation;
- successful plan run ID;
- exact confirmation:
  - `APPLY <alias> <component>`
  - `DESTROY <alias> <component>`

Both workflows:

- use `workflow_dispatch` only and have no `push` or `pull_request` trigger;
- run only from `main`;
- resolve the AWS account through `CREWSAFE_AWS_ACCOUNTS_JSON`;
- resolve paths and state keys exclusively through the catalog;
- assume the appropriate account-specific OIDC role;
- verify caller account, commit, provider lock and backend;
- use the exact reviewed binary plan;
- allow the same human to plan and apply while retaining distinct AWS roles;
- serialize operations by account alias and component;
- write component-scoped applied-plan markers.

Saved metadata includes component, Jira key, operation, root, backend strategy,
state key, alias, account, Region, commit, actor, run ID, Terraform version,
hashes and timestamp.

The generic backend writer accepts a validated catalog state key.
`self-bootstrap` preserves SCRUM-155’s special first-account migration behavior;
all normal infrastructure uses the existing managed S3 backend directly.

## SCRUM-154 Infrastructure

Replace `infra/aws/cognito-staging` with `infra/terraform/cognito`.

Create one deletion-protected `crewsafe-shared-dev` user pool with:

- administrator-created users only;
- case-insensitive email sign-in;
- agreed password policy;
- no MFA, SMS, Lambda triggers or advanced-security add-ons;
- stable, coarse-grained Cognito groups defined by Terraform;
- one account-derived Cognito domain;
- web and mobile public clients using authorization code only;
- one public CLI integration client using `USER_PASSWORD_AUTH`;
- no client secrets;
- no Terraform-managed users or passwords;
- outputs for pool ID/ARN, issuer, JWKS URI, domain and client IDs.

Use state key `crewsafe/cognito/shared-dev.tfstate`. The Cognito plan/apply role
policies are attached to the existing account roles; GitHub receives no
user/password administration permissions through those roles.

Terraform owns the user pool, clients, domain, password policy, deletion
protection and stable group definitions. It must not own individual users,
temporary passwords or group memberships. Remove the existing
`aws_cognito_user` demo resources and `demo_user_password` input so credentials
cannot enter Terraform configuration, plans, state or artifacts.

MFA remains optional for this shared development pool to keep integration
testing practical. Production infrastructure must require MFA, with TOTP
preferred over SMS, and must make its own explicit threat-protection decision.

## Cognito User Management

Use one manually dispatched, reusable GitHub Actions workflow for controlled
Cognito administration. This workflow is separate from Terraform validation,
plan and apply and supports only allowlisted operations:

- inspect/list users while emitting only immutable `sub` and lifecycle metadata;
- enable or disable a user;
- reset a password;
- globally sign out a user;
- add a user to or remove a user from a Terraform-defined group;
- inspect a user or list available groups for operator verification.

The workflow:

- uses `workflow_dispatch` only and has no path, push or pull-request trigger;
- runs from the default branch;
- accepts an account alias and resolves the account using
  `CREWSAFE_AWS_ACCOUNTS_JSON`;
- obtains short-lived AWS credentials through GitHub OIDC;
- assumes a dedicated account-specific Cognito user-administration role;
- restricts all actions to the catalogued shared-development user pool;
- validates operations and group names against an allowlist;
- never accepts or generates a password as a GitHub input;
- never prints passwords, tokens or sensitive user attributes;
- records actor, account alias, pool, operation, immutable target `sub`, group when
  applicable, result, run ID and timestamp in a sanitized workflow summary;
- relies on CloudTrail for the corresponding AWS management-event audit trail;
- serializes administration operations for the same account and user pool.

The dedicated administration role is separate from Terraform plan/apply roles.
Its reviewed policy contains only the required user-lifecycle and membership
actions, such as `AdminEnableUser`, `AdminDisableUser`,
`AdminResetUserPassword`, `AdminUserGlobalSignOut`, `AdminAddUserToGroup`,
`AdminRemoveUserFromGroup`, `ListUsers` and `ListGroups`. It has
no permission to create, update or delete user pools, clients or domains.

Initial creation is one account-owner Console action and Cognito sends a
temporary password valid for 30 days. Invitation resend is exceptional and
Console-only because Cognito implements resend through `AdminCreateUser`; the
GitHub role deliberately excludes that permission. Email never becomes a
workflow input.

Permanent user deletion is intentionally excluded from the initial workflow.
Offboarding disables the user, performs global sign-out, removes group
memberships and removes or disables the corresponding CrewSafe application
access. Deletion can be added later only with an explicit retention period,
confirmation control and reviewed recovery procedure.

Use one account per human; shared users and shared passwords are prohibited.
Email addresses, temporary passwords, access tokens and refresh tokens must not
be stored in Terraform, repository files, GitHub variables, workflow artifacts
or the CrewSafe database.

### Authorization ownership

Cognito groups provide only coarse, stable identity classification and are
included in token claims. Terraform owns the groups and the administration
workflow owns membership.

CrewSafe's database remains authoritative for application roles, permissions
and site membership. Fine-grained or frequently revoked access must not depend
only on Cognito group claims because issued tokens retain their claims until
they expire or are refreshed.

## Shared Developer Access

Create repository variable `CREWSAFE_SHARED_COGNITO_JSON` containing
non-sensitive infrastructure configuration and synthetic application identity
mappings. It must not contain emails, passwords or tokens.

Refactor developer startup so it:

- obtains configuration through authenticated GitHub CLI;
- does not invoke Terraform or require an AWS profile;
- starts only PostgreSQL, backend and web locally through the shared startup
  path, using `run.sh` for Podman or `run-docker.sh` for Docker;
- configures them against deployed AWS Cognito;
- seeds local application users from configured Cognito `sub` mappings instead
  of calling `AdminGetUser`.

The AWS account owner first bootstraps the GitHub OIDC plan/apply roles.
Terraform then provisions the dedicated Cognito administration role and its
restricted trust and permission policies. Thereafter, the account owner creates
one Cognito user per developer in the AWS Console. Cognito delivers the
temporary credential directly to the developer, who must replace it at first
sign-in. An authorized repository operator uses the controlled workflow only
for inspection, enable/disable, password reset, global sign-out, and approved
group membership. Each developer receives an application role and site
assignment through the non-sensitive mapping.

The Cognito administration role must use the same immutable owner/repository-ID
OIDC subject as the SCRUM-155 plan and apply roles:
`repo:<owner>@<OWNER_ID>/<repository>@<REPO_ID>:ref:refs/heads/main`.
`CREWSAFE_GITHUB_OIDC_MAIN_SUBJECT` supplies that reviewed value to the Cognito
plan. The legacy name-only form is invalid because this repository customizes
GitHub's OIDC `sub` claim with stable owner and repository IDs. Post-apply
verification compares the live role's provider account, audience and subject
exactly rather than accepting a main-branch-shaped value.

Remove Cognito from normal local Compose/runtime. Keep the pinned emulator and
synthetic fixtures test-scoped for deterministic CI only.

Create
`docs/adr/0006-shared-remote-cognito-for-development.md` (or the next available
ADR number if `0006` has already been allocated) to record this change. The new
ADR supersedes only the local-development decision in
[ADR 0004 — AWS Cognito for authentication](../adr/0004-aws-cognito-for-authentication.md);
ADR 0004's Hosted UI, PKCE, resource-server and local-authorization decisions
remain accepted. Cross-link both ADRs.

## Required Runbook

Create
[`docs/runbooks/SCRUM-154-shared-cognito.md`](../runbooks/SCRUM-154-shared-cognito.md)
as a required SCRUM-154 deliverable. The ticket cannot be accepted based only
on Terraform and workflow code.

The runbook must be executable by a developer who did not implement the
infrastructure and must include:

1. prerequisites, repository permissions and the requirement that each
   `workflow_dispatch` workflow file is merged into `main` before its first run;
2. how the account owner bootstraps GitHub OIDC and registers or switches a
   teammate-owned AWS account alias without local AWS profiles;
3. how to run generic Terraform validation, plan and apply for
   `cognito-shared-dev`, including required inputs, reviewed-plan run ID and
   exact apply confirmation;
4. how to verify the AWS account, Region, remote-state key, user pool, domain,
   clients, groups, issuer and JWKS endpoint after deployment;
5. how to populate and validate `CREWSAFE_SHARED_COGNITO_JSON` without adding
   email addresses, passwords or tokens;
6. how an authorized operator runs the controlled Cognito administration
   workflow from `main` to inspect, enable, disable, reset, globally sign out
   and manage group membership;
7. complete developer onboarding: the one Console creation action, Cognito
   invitation, first-login password
   replacement, application-user `sub` mapping, CrewSafe role/site assignment
   and `/api/v1/me` verification;
8. fresh-clone developer instructions for testing local backend/web code
   against the deployed shared Cognito pool without Terraform, AWS credentials
   or local Cognito;
9. offboarding in the safe order: disable, global sign-out, remove group
   memberships and remove or disable CrewSafe application access;
10. audit verification using the sanitized GitHub workflow summary and
    CloudTrail, including what must never appear in logs or artifacts;
11. troubleshooting and recovery for OIDC assumption failure, wrong account,
    stale or reused plans, partial apply, unavailable issuer/JWKS, invitation
    delivery failure, password reset, missing `sub` mapping and state
    reconciliation;
12. controlled teardown, including a reviewed apply that disables deletion
    protection followed by a separate reviewed destroy plan;
13. the periodic stale-user and group-membership review procedure.

The runbook must link to and remain consistent with:

- [ADR 0004 — AWS Cognito for authentication](../adr/0004-aws-cognito-for-authentication.md)
  for Hosted UI, PKCE, token validation, administered accounts and
  application-owned authorization;
- [ADR 0002 — Cookie-free bearer authentication](../adr/0002-cookie-free-bearer-authentication.md)
  for the stateless bearer-token boundary;
- [ADR 0005 — Browser token storage](../adr/0005-browser-token-storage.md)
  for web token handling;
- the new shared-remote-development Cognito ADR for the deployed-development
  decision and test-only emulator boundary;
- [SCRUM-155 Terraform state backend runbook](../runbooks/SCRUM-155-terraform-state-backend.md)
  for OIDC role and remote-state bootstrap/recovery steps that SCRUM-154 must
  reference instead of duplicating.

## Testing and Acceptance

### Generic workflow tests

- Unknown components, unsafe paths and duplicate state keys are rejected.
- Every deployable Terraform root is catalogued.
- Modules are excluded from root discovery.
- Terraform validation is triggered by changes under each allowlisted
  Terraform-related path.
- Application, documentation, local Compose, Spec Kit and unrelated workflow
  changes do not trigger Terraform validation.
- Plan, apply and Cognito administration remain manual-dispatch-only.
- Destroy is rejected unless the catalog explicitly allows it.
- Altered, expired, reused or cross-component plans fail before mutation.
- Adding a future Terraform root and catalog entry requires no workflow YAML
  change.
- Existing SCRUM-155 bootstrap and managed-account paths remain supported.

### Cognito tests

- Mock tests verify registration controls, password policy, deletion protection,
  email sign-in, static groups and all three client flow boundaries.
- The CLI client can obtain an access token without enabling password
  authentication on web/mobile clients.
- Issuer and JWKS are reachable by Spring Security.
- No password, token or secret appears in Terraform state, GitHub artifacts or
  logs.
- No Terraform resource manages an individual Cognito user or group membership.
- The administration workflow rejects unknown operations, groups, account
  aliases and user pools before assuming a role.
- The administration role cannot mutate user-pool, client or domain
  configuration.
- Inspect/list, disable, enable, reset, global sign-out and group-membership actions
  produce sanitized workflow summaries and corresponding CloudTrail events.
- Final Terraform plan reports no changes.

### Developer acceptance

At least two developers other than the infrastructure implementer demonstrate
from fresh clones that they can:

1. retrieve shared Cognito configuration through GitHub;
2. start the application without Terraform, AWS credentials or local Cognito;
3. sign in using their individual Cognito accounts;
4. call `/api/v1/me`;
5. receive the configured role and site access.

Recovery documentation covers partial apply, state reconciliation, pool
recreation, variable refresh and developer reconfiguration. Shared Cognito
teardown requires disabling deletion protection through a reviewed apply
followed by a reviewed generic destroy plan.

The user-management runbook also covers initial administration-role
provisioning, onboarding, disabling and re-enabling users, password reset,
global sign-out, group membership, offboarding, CloudTrail verification and
recovery when Cognito invitation delivery fails. It includes a periodic stale
account and group-membership review.

Runbook acceptance requires a second developer to follow it from a fresh clone
and record the tested account alias, workflow run IDs and verification result
without recording credentials or tokens. A documentation link check must
confirm that every ADR and runbook reference resolves.

## Jira and Documentation

- Rename SCRUM-154 to shared AWS Cognito development infrastructure.
- Replace test/staging requirements with the single shared environment and
  multi-developer acceptance criteria.
- Add the generic workflow/catalog extension procedure to the Terraform runbook
  so future Jira infrastructure does not create new workflows.
- Add the single controlled Cognito administration workflow and its user
  lifecycle runbook at
  `docs/runbooks/SCRUM-154-shared-cognito.md`. Document clearly that this is an
  administrative workflow, not an additional Terraform workflow.
- Add the shared-remote-development ADR and link it bidirectionally with ADR
  0004 and from the SCRUM-154 runbook.
- Update SCRUM-155 documentation to reference the generic plan/apply workflows.
- Preserve SCRUM-154’s parent, relationship to SCRUM-104, sprint, priority,
  assignee and In Progress status.
- Keep Spec Kit artifacts local and ignored; commit only the approved plan,
  runbooks, infrastructure, workflows, tests and lock files.

## Assumptions

- Future Terraform roots follow the standard account alias, account ID and
  Region input contract.
- Component-specific IAM permissions remain separate reviewed policies even
  though workflow orchestration is shared.
- One teammate-owned AWS account hosts the shared Cognito pool and its SCRUM-155
  backend.
- Developers may run application code and PostgreSQL locally; Cognito and
  Terraform infrastructure remain remote.
