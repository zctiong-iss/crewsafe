# CrewSafe Cognito administration

This directory contains the reviewed configuration used by the
[Cognito User Administration workflow](../workflows/cognito-user-administration.yml).
The workflow is the only supported path for Cognito administration from this
repository. It runs on `main`, uses GitHub OIDC to assume
`CrewSafeGitHubCognitoAdminRole` in the selected AWS account, and validates all
inputs before obtaining AWS credentials.

For the complete synthetic-user lifecycle, including creation, subject
binding, credential retrieval, rotation, and recovery, see the
[SCRUM-190 runbook](../../docs/runbooks/SCRUM-190-synthetic-cognito-users.md).

## Files

| File | Purpose |
| --- | --- |
| `admins.json` | Lowercase GitHub actors allowed to administer each account alias. |
| `admins.schema.json` | JSON Schema for the administrator allowlist. |
| `shared-config.schema.json` | Schema for the repository variable containing shared Cognito configuration. |
| `synthetic-users.yml` | Credential-free declarations for fictional test identities. |
| `synthetic-users.schema.json` | Schema and safety constraints for the synthetic-user manifest. |

The `cognito_sub` in `synthetic-users.yml` is an immutable binding. Leave it
`null` before first creation; after Cognito creates the identity, copy only the
sanitized `Subject` from the workflow summary into a reviewed pull request.
Never store passwords, tokens, or other credentials in this directory.

## Required repository configuration

The workflow reads these GitHub repository variables:

- `CREWSAFE_AWS_ACCOUNTS_JSON` — registered account IDs and regions.
- `CREWSAFE_SHARED_COGNITO_JSON` — deployed Cognito pool configuration for each
  account alias.

The administrator allowlist is read from `admins.json` unless the workflow
environment explicitly supplies `CREWSAFE_COGNITO_ADMINS_JSON`. The selected
account must also have the reviewed OIDC trust and IAM permissions for
`CrewSafeGitHubCognitoAdminRole`.

All pools must be in `ap-southeast-1`. Do not add AWS access keys, local AWS
profiles, passwords, or secret values to repository variables or source files.

## Running the workflow

1. Open **Actions → Cognito User Administration → Run workflow**.
2. Select `main`.
3. Enter the account alias and operation.
4. Supply the operation-specific fields below.
5. For a state-changing operation, enter the exact confirmation string.
6. Review the job summary. It must not contain a password or secret value.

The actor must be listed for the selected alias in `admins.json`. The workflow
uses concurrency per account and refuses to run from a feature branch.

### Operations

| Operation | Required target | Confirmation |
| --- | --- | --- |
| `inspect` | Cognito `sub` | — |
| `list-users` | — | — |
| `list-groups` | — | — |
| `enable`, `disable`, `reset-password`, `global-sign-out` | Human Cognito `sub` | `<operation> <alias> <sub>` |
| `add-to-group`, `remove-from-group` | Human Cognito `sub` and `group: developers` | `<operation> <alias> <sub>` |
| `reconcile-synthetic` | Synthetic key, or `all` | `reconcile-synthetic <alias> <key-or-all>` |
| `rotate-synthetic`, `enable-synthetic`, `disable-synthetic` | Synthetic key | `<operation> <alias> <key>` |

Use an immutable Cognito `sub`, not an email address or username, for human
operations. Generic human administration is denied for identities classified
as synthetic. Synthetic identities may only use the reserved
`@synthetic.crewsafe.invalid` namespace and the `synthetic-test-users` group.

## Adding a user

Choose the procedure based on the identity type. Do not add a real person to
`synthetic-users.yml`.

### Human or developer user

Human invitations are AWS Console-only; the GitHub role intentionally cannot
create users.

1. In the selected Cognito user pool, choose **Users → Create user**.
2. Enter the approved developer email and send the Cognito invitation. Never
   copy the temporary password into GitHub, Jira, chat, or source control.
3. Run this workflow with `list-users` and identify the new account by its
   creation time and status. Record only its immutable `sub`.
4. Run `add-to-group` with `group: developers` and confirmation
   `add-to-group <alias> <sub>`.
5. Add the user to the selected account's `application_users` array in
   `CREWSAFE_SHARED_COGNITO_JSON`, preserving all existing accounts and users:

   ```json
   {
     "username": "approved-developer",
     "cognito_sub": "REPLACE-WITH-IMMUTABLE-SUB",
     "display_name": "Approved Developer",
     "role": "SUPERVISOR",
     "site_codes": ["bishan"],
     "identity_kind": "developer"
   }
   ```

   Use the minimum approved role and explicit site list. The `username` is an
   internal application identifier, not an email address. Validate the updated
   configuration, then restart or redeploy the backend through its approved
   process; changing the repository variable does not update a running process.
   The developer completes the password change directly from the Cognito
   invitation.

### Synthetic test user

1. Add a declaration to `synthetic-users.yml` in a pull request. Use a unique
   key, a reserved `@synthetic.crewsafe.invalid` username, an approved role and
   site list, `group: synthetic-test-users`, a desired status, and
   `cognito_sub: null` for a new identity.
2. Merge the reviewed change to `main` after CI validation.
3. Run `reconcile-synthetic` for the account and key (or `all`) with exact
   confirmation, for example `reconcile-synthetic dev demo-worker`.
4. Copy only the generated `Subject` from the sanitized workflow summary into
   the matching `cognito_sub` field in a new pull request. Never copy a
   password or secret.
5. Merge the subject-binding change and run reconciliation again. The result
   should be `unchanged`; the bound subject is never changed or reused.
6. Retrieve the generated credential only from the selected account's AWS
   Secrets Manager. GitHub Actions does not read or print it.

Synthetic users do not receive email invitations. Their Cognito identity,
group, and CrewSafe application mapping are separate controls; the group alone
does not grant application access.

### Changing the `Synthetic ` naming rule

The `Synthetic ` prefix is a deliberate classification signal. Do not bypass
the check by editing only `synthetic-users.yml`. If the project needs names
such as `Harry`, make a reviewed security/contract change to all of these
locations:

1. Update the `display_name` pattern and description in
   `synthetic-users.schema.json`.
2. Update both `display_name` checks and the diagnostic message in
   `resolve-synthetic-users.sh` (the diagnostic validation and the final
   validation pass must remain consistent).
3. Update valid and invalid manifest fixtures under
   `.github/scripts/cognito/tests/fixtures/`.
4. Update this README, the synthetic-user runbook, and any test/UI assumptions
   that identify synthetic users by display name.
5. Add a negative test proving that the new rule still rejects an ambiguous or
   human-looking synthetic declaration, and run all Cognito shell tests.

Keep the reserved `@synthetic.crewsafe.invalid` username namespace and
`synthetic-test-users` group even if the display-name prefix changes. Those are
independent safeguards. Obtain review before merging because relaxing the
prefix can make a synthetic identity look like a real person in summaries or
the Cognito console.

## Safety model

- Authorization is checked against the selected account, operation, actor, and
  target before AWS credentials are configured.
- Mutations require exact, typed confirmation and are restricted to the
  allowlisted operations.
- Synthetic manifests are validated, checksummed before execution, and checked
  again during reconciliation to prevent stale approvals.
- Synthetic passwords are generated and stored in AWS Secrets Manager. The
  workflow does not read or print them.
- Cognito groups do not grant CrewSafe application roles; the backend uses the
  reviewed immutable-sub mapping and site assignments.
- A failed synthetic lifecycle operation requires review of the run summary and
  documented recovery before retrying.

Do not use this workflow for production access, real worker data, personal
email addresses, invitations to human users, deletion, or arbitrary Cognito
CLI commands. Human/developer invitations remain AWS Console-only.

## Validation

Changes to this directory should be made through a pull request. CI validates
the JSON/YAML manifests and Cognito administration guards. Run the focused
shell tests locally when changing related scripts:

```bash
for test in .github/scripts/cognito/tests/test-*.sh; do
  "$test"
done
```

Do not run Terraform or mutate AWS from a workstation; use the reviewed GitHub
Actions workflows.
