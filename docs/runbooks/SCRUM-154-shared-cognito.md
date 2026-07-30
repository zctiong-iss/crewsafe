# SCRUM-154 Shared Cognito Runbook

This runbook provisions and operates the `cognito-shared-dev` Terraform
component. It is written for account owners, infrastructure operators, and
developers who need to use the remotely deployed CrewSafe Cognito environment.

Terraform runs only in GitHub Actions. Never run `terraform init`, plan, apply,
destroy, import, state, or force-unlock on a workstation. Do not configure a
local AWS profile or download Terraform state or saved-plan artifacts.

Related decisions and prerequisites:

- [ADR 0002 — Cookie-free bearer authentication](../adr/0002-cookie-free-bearer-authentication.md)
- [ADR 0004 — AWS Cognito for authentication](../adr/0004-aws-cognito-for-authentication.md)
- [ADR 0005 — Browser token storage](../adr/0005-browser-token-storage.md)
- [ADR 0006 — Shared remote Cognito for development](../adr/0006-shared-remote-cognito-for-development.md)
- [SCRUM-155 state-backend runbook](SCRUM-155-terraform-state-backend.md)

## 1. What this procedure creates

For each registered AWS account alias, `cognito-shared-dev` creates:

- one deletion-protected Cognito Essentials user pool named
  `crewsafe-shared-dev`;
- one Cognito Hosted UI domain;
- public web and mobile clients using authorization code flow without client
  secrets;
- one bounded CLI integration client that permits password authentication;
- classification-only `developers` and `synthetic-test-users` groups;
- one `CrewSafeGitHubCognitoAdminRole` for controlled user administration.

The groups do not grant CrewSafe application roles or site access. The
CrewSafe database remains authoritative for application authorization.
Terraform does not create users, passwords, invitations, or group memberships.

## 2. End-to-end checklist

Complete the phases in this order:

1. Confirm the selected account's SCRUM-155 backend is healthy.
2. Add Cognito permissions to the account's existing GitHub OIDC plan/apply
   roles.
3. Register the account and exact OIDC subject in GitHub repository variables.
4. Add approved GitHub administrators to `.github/cognito/admins.json` through
   a reviewed pull request.
5. Merge the reviewed Cognito workflow and Terraform files to `main`.
6. Run and review **Terraform Plan** for `cognito-shared-dev`.
7. Apply the exact saved plan through **Terraform Apply**.
8. Run a second plan and confirm that it has no changes.
9. Publish the non-sensitive Cognito configuration as a GitHub repository
   variable.
10. Invite developers with one AWS Console create-user action each.
11. Use the controlled administration workflow for group membership and later
    lifecycle operations.
12. Have two developers other than the infrastructure implementer test from
    fresh clones.

Stop at the first failed phase. Do not skip ahead or compensate with local
Terraform or AWS credentials.

## 3. Phase A — Preflight and account selection

### 3.1 Select an account alias

Use a lowercase alias containing only letters, digits, and hyphens. This
runbook uses:

```text
zctiong
```

The alias is a selector, not an AWS profile. Every account has its own state
bucket, Terraform roles, Cognito pool, users, and application configuration.

### 3.2 Verify the SCRUM-155 backend

1. Open the repository on GitHub.
2. Open **Actions → Terraform Plan → Run workflow**.
3. Select branch `main`.
4. Enter:
   - `target_account_alias`: `zctiong`
   - `terraform_component`: `state-backend`
   - `operation`: `apply`
5. Run the workflow.
6. Confirm that it succeeds and reports no infrastructure changes.
7. Confirm that the selected state bucket is in `ap-southeast-1`.
8. Record the run URL as prerequisite evidence.

If the backend plan fails, stop and follow the
[SCRUM-155 recovery procedure](SCRUM-155-terraform-state-backend.md#7-failure-and-recovery).

### 3.3 Confirm the GitHub OIDC provider

In the selected AWS account:

1. Sign in to the AWS Console as an account owner or approved IAM
   administrator.
2. Select Region **Asia Pacific (Singapore) — `ap-southeast-1`**.
3. Open **IAM → Identity providers**.
4. Confirm an OpenID Connect provider exists for:
   - Provider URL: `https://token.actions.githubusercontent.com`
   - Audience: `sts.amazonaws.com`
5. Do not create an IAM user or access key for GitHub.

## 4. Phase B — Grant the existing Terraform roles Cognito permissions

The selected account must already contain:

- `CrewSafeGitHubTerraformPlanRole`
- `CrewSafeGitHubTerraformApplyRole`

Do not replace their SCRUM-155 policies. Add the reviewed Cognito permissions
as additional inline policies.

### 4.1 Update the plan role

1. In AWS Console, open **IAM → Roles**.
2. Select `CrewSafeGitHubTerraformPlanRole`.
3. Open **Permissions → Add permissions → Create inline policy**.
4. Select the **JSON** editor.
5. Copy the complete reviewed document from
   `infra/terraform/cognito/iam/plan-role-policy.json`.
6. Review that it contains read-only Cognito and IAM actions, including:
   - `cognito-idp:GetUserPoolMfaConfig`, which the AWS provider uses when
     refreshing the declared user-pool MFA configuration;
   - `iam:ListAttachedRolePolicies`, which the provider uses when refreshing
     `CrewSafeGitHubCognitoAdminRole`.
7. Name the policy `CrewSafeCognitoTerraformPlan`.
8. Save the policy.

The plan role must not receive Cognito create, update, delete, user
administration, or IAM mutation permissions.

### 4.2 Update the apply role

1. Return to **IAM → Roles**.
2. Select `CrewSafeGitHubTerraformApplyRole`.
3. Open **Permissions → Add permissions → Create inline policy**.
4. Select the **JSON** editor.
5. Copy the complete reviewed document from
   `infra/terraform/cognito/iam/apply-role-policy.json`.
6. Confirm that the policy contains
   `cognito-idp:GetUserPoolMfaConfig`,
   `cognito-idp:SetUserPoolMfaConfig`, and
   `iam:ListAttachedRolePolicies`, and
   `iam:ListInstanceProfilesForRole`. The last action is a read that the AWS
   provider performs before deleting the managed administration role, even
   when the role has no instance-profile associations.
7. Confirm that IAM mutation is limited to
   `CrewSafeGitHubCognitoAdminRole`.
8. Confirm that the policy does not permit `RemoveRoleFromInstanceProfile`,
   `DeleteInstanceProfile`, `AddRoleToInstanceProfile`, `AdminCreateUser`,
   `AdminDeleteUser`, `AdminSetUserPassword`, or access-key management.
9. Name the policy `CrewSafeCognitoTerraformApply`.
10. Save the policy.

Do not broaden either policy in the AWS Console. Policy changes belong in a
reviewed repository change first.

## 5. Phase C — Configure GitHub

Repository variables are under **Settings → Secrets and variables → Actions →
Variables**. Preserve existing account entries when editing a JSON variable.

### 5.1 Register `zctiong`

Create or update `CREWSAFE_AWS_ACCOUNTS_JSON`:

```json
{
  "zctiong": {
    "account_id": "123456789012",
    "region": "ap-southeast-1",
    "plan_role_arn": "arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformPlanRole",
    "apply_role_arn": "arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformApplyRole"
  }
}
```

Replace every sample account ID with the selected account's real 12-digit ID.
Do not put access keys, session tokens, passwords, AWS profiles, or credit
details in the variable.

### 5.2 Set the immutable main-branch OIDC subject

This repository customizes GitHub's OIDC `sub` claim with immutable owner and
repository IDs. Obtain the IDs from an authenticated workstation:

```bash
gh api repos/zctiong-iss/crewsafe \
  --jq '"owner_id=\(.owner.id)\nrepo_id=\(.id)"'
```

Alternatively, copy the exact `sub` condition from the working
`CrewSafeGitHubTerraformPlanRole` trust policy. For this repository, create or
update `CREWSAFE_GITHUB_OIDC_MAIN_SUBJECT` with:

```text
repo:zctiong-iss@267492605/crewsafe@1310783821:ref:refs/heads/main
```

The value must exactly match the `sub` condition trusted by the selected
account's Terraform plan and apply roles. The legacy name-only value
`repo:zctiong-iss/crewsafe:ref:refs/heads/main` does not match the customized
token and is rejected. Wildcards, pull-request subjects, environment subjects,
feature branches, and IDs copied from a fork or replacement repository are
also rejected.

Changing this repository variable does not update an existing AWS role. After
the corrected implementation and variable are on `main`, generate a fresh
`cognito-shared-dev` plan, review the administration-role trust update, and
apply that exact saved plan before using Cognito User Administration.

### 5.3 Allowlist Cognito workflow administrators

Add the account alias and approved lowercase GitHub actors to
`.github/cognito/admins.json`:

```json
{
  "schema_version": 1,
  "accounts": {
    "zctiong": [
      "zctiong-iss"
    ]
  }
}
```

Commit this file through a reviewed pull request. The administration workflow
is fail-closed: an unknown alias, malformed file, duplicate actor, uppercase
actor, or actor not listed for the selected account is rejected before GitHub
obtains AWS credentials.

### 5.4 Pre-deployment GitHub checks

Before planning Cognito, confirm:

- the implementation and allowlist are merged to `main`;
- **Terraform Validation** is green;
- `infra/terraform/cognito/.terraform.lock.hcl` is committed;
- `zctiong` exists in `CREWSAFE_AWS_ACCOUNTS_JSON`;
- `CREWSAFE_GITHUB_OIDC_MAIN_SUBJECT` exactly matches the immutable ID-bound
  `sub` in both SCRUM-155 Terraform role trust policies;
- no long-lived AWS credential is stored in GitHub.

Plan, apply, and administration workflows intentionally reject non-`main`
refs.

## 6. Phase D — Generate and review the Cognito plan

### 6.1 Dispatch the plan

1. Open **Actions → Terraform Plan**.
2. Select **Run workflow**.
3. Select branch `main`.
4. Enter:
   - `target_account_alias`: `zctiong`
   - `terraform_component`: `cognito-shared-dev`
   - `operation`: `apply`
5. Select **Run workflow**.
6. Wait for the `plan` job to finish successfully.

### 6.2 Review the plan

Open the workflow log and confirm:

- the resolved component is `cognito-shared-dev`;
- the root is `infra/terraform/cognito`;
- the state key is `crewsafe/cognito/shared-dev.tfstate`;
- the selected Region is `ap-southeast-1`;
- the assumed role is the selected account's plan role;
- the account verification step succeeds;
- the operation is `apply`;
- the commit belongs to `main`;
- there are no users, passwords, invitations, memberships, IAM users, access
  keys, or unrelated resources.

For the first deployment, the plan should cover the user pool, domain, three
clients, two groups, administration role and inline administration policy.
Stop if the plan deletes or replaces an unexpected resource.

### 6.3 Record the saved-plan identity

Record:

- workflow run URL;
- numeric run ID from the URL;
- run attempt, normally `1`;
- commit SHA;
- account alias;
- component and operation;
- reviewer and review time.

The saved plan expires after 24 hours. A rerun has a new run attempt. Never
guess the attempt and never reuse a plan after a repository, account,
component, operation, provider-lock, or catalog change.

## 7. Phase E — Apply the exact reviewed plan

### 7.1 Dispatch the apply

1. Open **Actions → Terraform Apply**.
2. Select **Run workflow**.
3. Select branch `main`.
4. Enter:
   - `target_account_alias`: `zctiong`
   - `terraform_component`: `cognito-shared-dev`
   - `operation`: `apply`
   - `plan_run_id`: the reviewed plan run ID
   - `plan_run_attempt`: the reviewed run attempt
   - `confirmation`: `APPLY zctiong cognito-shared-dev`
5. Check every input again.
6. Select **Run workflow**.

The same person may plan and apply in a test account. The saved plan and typed
confirmation remain mandatory.

### 7.2 Expected apply safeguards

The workflow must:

1. reject an incorrect confirmation;
2. download the named artifact from the successful plan run;
3. prove that the source was `Terraform Plan` on `main`;
4. check out the exact planned commit;
5. validate plan, lockfile, catalog, account, Region, component, operation,
   attempt, age, and hashes;
6. assume the selected account's apply role;
7. reject a previously applied plan;
8. apply the saved binary plan without replanning;
9. record plan consumption in the selected state bucket;
10. verify the deployed Cognito boundary.

### 7.3 Review the deployment verification

Confirm the final verification reports success for:

- selected AWS account and Region;
- state key `crewsafe/cognito/shared-dev.tfstate`;
- pool name `crewsafe-shared-dev`;
- deletion protection `ACTIVE`;
- Cognito tier `ESSENTIALS`;
- public self-registration disabled;
- case-insensitive verified-email sign-in;
- 30-day temporary password validity;
- three public clients without secrets;
- password authentication enabled only on the CLI integration client;
- exactly the two approved groups with no IAM role or precedence;
- exact main-branch trust on `CrewSafeGitHubCognitoAdminRole`;
- reachable issuer JWKS.

If any verification fails, treat the apply as incomplete and follow section
14. Do not immediately rerun it.

### 7.4 Inspect the expected resources in AWS Console

After the apply workflow reports
`Shared Cognito deployment boundary verified.`, inspect the selected
`zctiong` account in Region `ap-southeast-1`.

| AWS Console area | Expected result |
|---|---|
| **Amazon Cognito → User pools** | One pool named `crewsafe-shared-dev` |
| **User pool → App clients** | `crewsafe-web`, `crewsafe-mobile`, and `crewsafe-cli-integration` |
| **User pool → Groups** | `developers` and `synthetic-test-users` |
| **User pool → App integration → Domain** | `crewsafe-shared-dev-<AWS_ACCOUNT_ID>` |
| **IAM → Roles** | `CrewSafeGitHubCognitoAdminRole` |
| **S3 → selected SCRUM-155 state bucket** | State under `crewsafe/cognito/shared-dev.tfstate` |

AWS Console labels can move between console versions. Verify the underlying
settings below even if the navigation label differs.

#### 7.4.1 User pool

Open **Amazon Cognito → User pools → `crewsafe-shared-dev`** and confirm:

- tier is `Essentials`;
- deletion protection is `Active`;
- self-service or public sign-up is disabled;
- users sign in with email;
- email is automatically verified;
- sign-in matching is case-insensitive;
- MFA is off;
- minimum password length is 12;
- uppercase, lowercase, number, and symbol are required;
- temporary passwords are valid for 30 days.

Immediately after Terraform apply, the **Users** list should be empty. Users
appear only after the account owner completes the manual invitation procedure
in section 10.

#### 7.4.2 Web client

Open the `crewsafe-web` app client and confirm:

- no client secret exists;
- authorization code flow is enabled;
- OAuth scopes are `openid`, `email`, and `profile`;
- callback URL is `http://localhost:5173/callback`;
- logout URL is `http://localhost:5173/`;
- access token validity is 15 minutes;
- ID token validity is 15 minutes;
- refresh token validity is 7 days;
- password authentication is not enabled;
- refresh-token authentication and token revocation are enabled.

#### 7.4.3 Mobile client

Open the `crewsafe-mobile` app client and confirm:

- no client secret exists;
- authorization code flow is enabled;
- OAuth scopes are `openid`, `email`, and `profile`;
- callback URL is `crewsafe://callback`;
- logout URL is `crewsafe://`;
- access token validity is 1 hour;
- ID token validity is 60 minutes;
- refresh token validity is 7 days;
- password authentication is not enabled;
- refresh-token authentication and token revocation are enabled.

#### 7.4.4 CLI integration client

Open the `crewsafe-cli-integration` app client and confirm:

- no client secret exists;
- `ALLOW_USER_PASSWORD_AUTH` is enabled;
- refresh-token authentication is enabled;
- access token validity is 15 minutes;
- ID token validity is 15 minutes;
- refresh token validity is 1 day;
- token revocation is enabled.

Only this CLI integration client may permit username/password authentication.
Stop if the web or mobile client permits it.

#### 7.4.5 Groups

Open the user pool's **Groups** view and confirm exactly:

- `developers`
- `synthetic-test-users`

Neither group should have an IAM role or precedence value. Membership in these
groups does not grant a CrewSafe application role or site access.

#### 7.4.6 Hosted UI, issuer, and JWKS

Under **App integration → Domain**, confirm the domain prefix is:

```text
crewsafe-shared-dev-<AWS_ACCOUNT_ID>
```

The resulting Hosted UI URL should be:

```text
https://crewsafe-shared-dev-<AWS_ACCOUNT_ID>.auth.ap-southeast-1.amazoncognito.com
```

Using the displayed user pool ID, verify:

```text
Issuer: https://cognito-idp.ap-southeast-1.amazonaws.com/<USER_POOL_ID>
JWKS:   https://cognito-idp.ap-southeast-1.amazonaws.com/<USER_POOL_ID>/.well-known/jwks.json
```

Open the JWKS URL in a browser. It must return JSON with a non-empty `keys`
array.

#### 7.4.7 Cognito administration role

Open **IAM → Roles → `CrewSafeGitHubCognitoAdminRole`** and confirm:

- the trusted identity is the selected account's GitHub OIDC provider;
- audience is exactly `sts.amazonaws.com`;
- subject is the exact repository `main` branch subject;
- the subject contains no wildcard;
- the inline policy is scoped to the deployed user pool;
- allowed actions cover sanitized listing, enable/disable, password reset,
  global sign-out, and approved group membership changes;
- the role cannot create or delete users, set passwords, update user
  attributes, authenticate users, or modify pool/client/domain/group
  definitions.

#### 7.4.8 Remote-state evidence

Open the selected SCRUM-155 state bucket and confirm the Cognito component uses:

```text
crewsafe/cognito/shared-dev.tfstate
```

Do not open, download, copy, or edit the state object. Its existence and
version history are the only Console checks needed.

### 7.5 Confirm what must not exist

Stop and investigate if the apply created any of the following:

- a second test or staging user pool;
- Terraform-managed users, passwords, invitations, or memberships;
- a client secret for any of the three app clients;
- password authentication on the web or mobile client;
- IAM users or AWS access keys;
- an IAM role or precedence attached to either Cognito group;
- a DynamoDB locking table;
- state outside the selected account's SCRUM-155 bucket and canonical key;
- unrelated infrastructure.

## 8. Phase F — Prove idempotence

After a successful apply:

1. Run **Terraform Plan** again from `main`.
2. Use `zctiong`, `cognito-shared-dev`, and `apply`.
3. Confirm the plan reports no changes.
4. Record the no-change plan URL in SCRUM-154.
5. Do not run **Terraform Apply** for a no-change plan.

A no-change plan is required before publishing the environment for teammates.

## 9. Phase G — Publish non-sensitive runtime configuration

### 9.1 Collect values from AWS Console

Do not download state or run Terraform locally. In AWS Console:

1. Open **Amazon Cognito → User pools → `crewsafe-shared-dev`**.
2. Record the user pool ID.
3. Open **App integration**.
4. Record the Hosted UI domain.
5. Record the client IDs for:
   - `crewsafe-web`
   - `crewsafe-mobile`
   - `crewsafe-cli-integration`
6. Construct:
   - issuer: `https://cognito-idp.ap-southeast-1.amazonaws.com/<POOL_ID>`
   - JWKS: `<ISSUER>/.well-known/jwks.json`
7. Open the JWKS URL in a browser and confirm it returns a non-empty `keys`
   array.

Client IDs, pool IDs, issuer URLs and domain URLs are identifiers, not
credentials. Do not publish email addresses, passwords, temporary passwords,
tokens, full AWS account IDs, or user attributes.

### 9.2 Create the repository variable

In **Settings → Secrets and variables → Actions → Variables**, create or update
`CREWSAFE_SHARED_COGNITO_JSON`:

```json
{
  "schema_version": 1,
  "accounts": {
    "zctiong": {
      "region": "ap-southeast-1",
      "user_pool_id": "ap-southeast-1_REPLACE",
      "issuer_uri": "https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_REPLACE",
      "jwks_uri": "https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_REPLACE/.well-known/jwks.json",
      "hosted_ui_url": "https://REPLACE.auth.ap-southeast-1.amazoncognito.com",
      "web_client_id": "REPLACE",
      "mobile_client_id": "REPLACE",
      "cli_client_id": "REPLACE",
      "groups": [
        "developers",
        "synthetic-test-users"
      ],
      "application_users": []
    }
  }
}
```

Replace every `REPLACE` value. Preserve other account entries. The group order
must remain exactly as shown.

### 9.3 Verify configuration retrieval

From an authenticated developer workstation:

```bash
gh auth status
gh variable get CREWSAFE_SHARED_COGNITO_JSON --json value --jq '.value'
```

Confirm the output contains the selected alias and no PII or credentials. Do
not paste the complete value into Jira or public logs.

## 10. Phase H — Invite the initial developer

Initial invitations and invitation resends are the only routine user actions
performed in AWS Console. GitHub intentionally lacks `AdminCreateUser`.

### 10.1 Create the user

1. Open **Amazon Cognito → User pools → `crewsafe-shared-dev`**.
2. Open **Users**.
3. Select **Create user**.
4. Enter the approved developer email only in the Cognito form.
5. Choose the option that sends an email invitation.
6. Allow Cognito to generate the temporary password.
7. Do not copy the temporary password into GitHub, Jira, chat, source control,
   or operator notes.
8. Submit the form.
9. Confirm the user status is `FORCE_CHANGE_PASSWORD`.

The temporary password is valid for 30 days.

### 10.2 Identify the immutable `sub`

1. Open **Actions → Cognito User Administration**.
2. Select branch `main`.
3. Enter:
   - `target_account_alias`: `zctiong`
   - `operation`: `list-users`
   - `cognito_sub`: blank
   - `group`: blank
   - `confirmation`: blank
4. Run the workflow.
5. Use creation time and status to identify the new user.
6. Record only its immutable `sub`.

The workflow output intentionally omits email and other user attributes.

### 10.3 Add the developer group

Run **Cognito User Administration** again:

- `target_account_alias`: `zctiong`
- `operation`: `add-to-group`
- `cognito_sub`: the immutable `sub`
- `group`: `developers`
- `confirmation`: `add-to-group zctiong <sub>`

Confirm the run succeeds. Do not use email as `cognito_sub`.

### 10.4 Add the CrewSafe application mapping

Update the `application_users` array in
`CREWSAFE_SHARED_COGNITO_JSON`. Example:

```json
{
  "username": "zctiong",
  "cognito_sub": "REPLACE-WITH-IMMUTABLE-SUB",
  "display_name": "Zhong Cheng Tiong",
  "role": "SUPERVISOR",
  "site_codes": [
    "bishan"
  ],
  "identity_kind": "developer"
}
```

The mapping contains no email. `role` must be one of `WORKER`, `SUPERVISOR`,
`SAFETY_MANAGER`, or `ADMIN`. Site codes must be explicitly approved for the
developer and must currently be `bishan` or `campus`. Cognito groups never
replace this mapping.

### 10.5 Complete first sign-in

1. The developer opens CrewSafe login.
2. The developer signs in with the invitation received directly from Cognito.
3. Cognito requires a permanent password.
4. The developer completes the password change without involving the operator.
5. The operator verifies that the user status is no longer
   `FORCE_CHANGE_PASSWORD`.

If the invitation was not delivered or expired, use **Resend invitation** in
AWS Console. Do not add `AdminCreateUser` to the GitHub role as a workaround.

### 10.6 Add a synthetic demo user for end-to-end login testing

A synthetic demo user is a real login identity in the shared Cognito user
pool, but it must not represent a real worker or reuse a developer's personal
account. It requires both:

1. a Cognito identity that can authenticate and receive a JWT; and
2. a CrewSafe `application_users` mapping that binds the JWT's immutable
   `sub` to a role and approved sites.

Creating only one side is intentionally insufficient. An unmapped Cognito
identity can authenticate but must be denied by CrewSafe, while a mapping
without a Cognito identity cannot log in.

#### Recommended demo roster

Start with these four synthetic users. They cover every CrewSafe role without
using a real person's account:

| CrewSafe username | Role | Sites | Main demonstration |
|---|---|---|---|
| `demo-worker-bishan` | `WORKER` | `bishan` | Worker login and worker-only functions |
| `demo-supervisor-bishan` | `SUPERVISOR` | `bishan` | Crew supervision at one assigned site |
| `demo-safety-manager` | `SAFETY_MANAGER` | `bishan`, `campus` | Safety oversight across both demo sites |
| `demo-admin` | `ADMIN` | `bishan`, `campus` | Administration functions |

Add these only when their negative scenarios are required:

| Cognito identity | CrewSafe mapping | Purpose |
|---|---|---|
| `demo-supervisor-campus` | `SUPERVISOR`, `campus` | Compare two supervisors and prove cross-site isolation |
| `demo-unmapped` | None | Prove that valid Cognito authentication alone is denied by CrewSafe |

Do not create separate identities for every test case. Reuse the minimum
roster unless tests run concurrently or require conflicting account states.
Never give `demo-unmapped` an `application_users` entry.

#### 10.6.1 Prepare the test identity

Repeat this preparation for each selected roster entry:

1. Obtain a project-controlled, non-personal test email inbox or email alias
   that the E2E tester can access. Use one unique alias per Cognito identity.
2. Copy the username, role, and sites from the roster. Do not replace them
   with a real person's name.
3. Confirm that the role and sites are the minimum required by the test.
4. Choose only the supported site codes `bishan` and/or `campus`.
5. Prepare an approved secret-manager entry for the login email and password.
6. Confirm that the identity contains no real worker name, phone number, or
   other personal data.

The test email and all passwords are credentials or user attributes. Never
put them in `CREWSAFE_SHARED_COGNITO_JSON`, source control, Jira, workflow
inputs, workflow summaries, screenshots, recordings, or chat.

#### 10.6.2 Create the Cognito identity

Initial user creation remains AWS Console-only. Repeat these steps for each
selected roster entry:

1. Sign in to the AWS account for the selected alias.
2. Open **Amazon Cognito → User pools → `crewsafe-shared-dev` → Users**.
3. Select **Create user**.
4. Enter that identity's project-controlled test email as the username.
5. For a no-email setup, choose **Don't send an invitation**.
6. Choose **Create a password** and enter a unique temporary password that
   satisfies the pool's 12-character uppercase, lowercase, number, and symbol
   policy.
7. Save the email and temporary password directly into the approved
   secret-manager entry. Do not stage them in a text file or clipboard
   manager.
8. Submit the Cognito form.
9. Confirm that exactly one new enabled user appears with status
   `FORCE_CHANGE_PASSWORD`.
10. Record the creation time, but do not copy the email or temporary password
   into operator notes.

Do not create the identity with a personal email merely for convenience. Do
not choose **Don't send an invitation** unless the approved secret manager is
ready and the tester can access the temporary password there. If no approved
secret-delivery mechanism exists, send Cognito's invitation to the
project-controlled inbox instead. AWS documents both console choices under
[Creating user accounts as administrator](https://docs.aws.amazon.com/cognito/latest/developerguide/how-to-create-user-accounts.html).

#### 10.6.3 Retrieve the immutable `sub`

Immediately after creating each identity:

1. Open **Actions → Cognito User Administration** in GitHub.
2. Select branch `main`.
3. Run with:
   - `target_account_alias`: the selected alias, for example `zctiong`;
   - `operation`: `list-users`;
   - `cognito_sub`: blank;
   - `group`: blank;
   - `confirmation`: blank.
4. Match the newly created identity using its creation time and
   `FORCE_CHANGE_PASSWORD` status.
5. Record only the returned immutable `sub` beside its non-sensitive
   CrewSafe username.
6. If more than one result could match, stop and identify the user in AWS
   Console. Never guess a `sub`.

#### 10.6.4 Classify it as a synthetic test identity

For each newly recorded `sub`, run **Cognito User Administration** again:

- `target_account_alias`: the selected alias;
- `operation`: `add-to-group`;
- `cognito_sub`: the immutable `sub`;
- `group`: `synthetic-test-users`;
- `confirmation`: `add-to-group <alias> <sub>`.

The group is classification and audit metadata only. It does not grant a
CrewSafe role or site access.

#### 10.6.5 Add the CrewSafe mapping

Add one object to the selected account's `application_users` array in the
GitHub repository variable `CREWSAFE_SHARED_COGNITO_JSON`:

```json
[
  {
    "username": "demo-worker-bishan",
    "cognito_sub": "REPLACE-WORKER-SUB",
    "display_name": "Synthetic Bishan Worker",
    "role": "WORKER",
    "site_codes": ["bishan"],
    "identity_kind": "synthetic-test"
  },
  {
    "username": "demo-supervisor-bishan",
    "cognito_sub": "REPLACE-SUPERVISOR-SUB",
    "display_name": "Synthetic Bishan Supervisor",
    "role": "SUPERVISOR",
    "site_codes": ["bishan"],
    "identity_kind": "synthetic-test"
  },
  {
    "username": "demo-safety-manager",
    "cognito_sub": "REPLACE-SAFETY-MANAGER-SUB",
    "display_name": "Synthetic Safety Manager",
    "role": "SAFETY_MANAGER",
    "site_codes": ["bishan", "campus"],
    "identity_kind": "synthetic-test"
  },
  {
    "username": "demo-admin",
    "cognito_sub": "REPLACE-ADMIN-SUB",
    "display_name": "Synthetic Administrator",
    "role": "ADMIN",
    "site_codes": ["bishan", "campus"],
    "identity_kind": "synthetic-test"
  }
]
```

Use the objects inside this example array as entries in the existing selected
account's `application_users` array. Do not replace the entire repository
variable with the example. Preserve every account and existing
application-user entry. Before saving, confirm:

- each `cognito_sub` exactly matches its Cognito result and is not an email;
- the username and `cognito_sub` are each unique within the account;
- `identity_kind` is `synthetic-test`;
- the role is the minimum required by the scenario;
- every site code is `bishan` or `campus`; and
- the JSON contains no email, password, access token, or AWS credential.

Retrieve and validate the variable as described in section 9.3. The backend
consumes application mappings at startup. A long-running deployed backend must
be redeployed or restarted through its approved deployment process; changing
the GitHub variable alone does not modify an already-running process.

#### 10.6.6 Start CrewSafe with Podman or Docker

The local backend and web app can test these identities directly against the
deployed shared Cognito pool. No local Cognito, AWS profile, AWS credential, or
local Terraform is used. Choose one installed container engine for the entire
local run:

1. Confirm the Cognito users, immutable `sub` values, group memberships, and
   `application_users` mappings are complete.
2. Stop any earlier `run.sh` or `run-docker.sh` process.
3. From the repository root, authenticate GitHub CLI:

   ```bash
   gh auth status
   ```

4. Start the application for the selected account with one of:

   ```bash
   # Podman
   ./run.sh --account zctiong

   # Docker Engine or Docker Desktop with Compose v2
   ./run-docker.sh --account zctiong
   ```

   `run.sh` defaults to Podman. `run-docker.sh` selects Docker and delegates to
   the same validated startup logic; do not set the internal engine selector
   directly.
5. Leave that terminal running. The selected launcher tails
   `.local-run/backend.log` after the backend becomes healthy and stops its
   PostgreSQL container when the launcher exits.
6. Open `http://localhost:5173` in a browser.
7. If startup fails, inspect `.local-run/backend.log` without copying tokens,
   email addresses, or credentials into an issue.

On every startup, the backend reconciles the reviewed mapping:

- a new username and `sub` creates one local application user;
- an existing matching username and `sub` updates reviewed display name,
  role, and exact site memberships without creating duplicates;
- an inactive local user remains inactive;
- removing a mapping makes its local user inactive on the next startup;
- an empty `application_users` array starts safely with no active mapped
  users; and
- a username/immutable-`sub` conflict aborts startup instead of silently
  rebinding an identity.

Adding another synthetic user later therefore requires updating
`CREWSAFE_SHARED_COGNITO_JSON`, stopping the active launcher, and running the
same engine-specific command again. A database reset is not normally required.

For a deliberately clean local acceptance run only, use:

```bash
# Podman
./run.sh --account zctiong --reset

# Docker
./run-docker.sh --account zctiong --reset
```

`--reset` deletes the local CrewSafe PostgreSQL volume and recreates local
application data. It does not change Cognito, GitHub variables, Terraform
state, or AWS infrastructure. Do not use it if local application data must be
preserved. Docker and Podman maintain separate local container/volume stores;
switching engines does not migrate local data between them.

#### 10.6.7 Complete the first login

Repeat this once for each mapped demo user:

1. Open CrewSafe in a fresh private browser session.
2. Select the normal CrewSafe login action so the browser is redirected to
   the Cognito Hosted UI.
3. Retrieve that identity's email and temporary password from the approved
   secret manager.
4. Sign in through the Hosted UI.
5. When Cognito presents `NEW_PASSWORD_REQUIRED`, set a new unique password
   that satisfies the pool policy.
6. Replace the temporary password in the secret manager with the permanent
   test password.
7. Confirm the browser returns to CrewSafe.
8. Sign out before testing the next identity.
9. Confirm AWS Console now shows the completed user as enabled and no longer
   in `FORCE_CHANGE_PASSWORD`.

For automated browser E2E execution, inject the email and password only from
protected CI environment secrets. Mask them, disable credential logging, and
ensure failure screenshots, videos, traces, and HTML reports cannot capture
the password field or token-bearing URLs. Do not pass either credential as a
workflow-dispatch input.

#### 10.6.8 Verify application authorization

Complete all of these checks:

1. Log in as `demo-worker-bishan`; confirm `/api/v1/me` returns `WORKER` and
   only `bishan`.
2. Log in as `demo-supervisor-bishan`; confirm `/api/v1/me` returns
   `SUPERVISOR` and only `bishan`.
3. As the Bishan supervisor, attempt a Campus-scoped request and confirm it is
   denied server-side.
4. Log in as `demo-safety-manager`; confirm `/api/v1/me` returns
   `SAFETY_MANAGER`, `bishan`, and `campus`.
5. Log in as `demo-admin`; confirm `/api/v1/me` returns `ADMIN` and both demo
   sites.
6. If `demo-unmapped` was created, log in successfully through Cognito and
   confirm CrewSafe denies `/api/v1/me`.
7. For every mapped user, exercise one allowed operation appropriate to the
   role and confirm a higher-privilege operation is denied where applicable.
8. Sign out, confirm the local session is cleared, and sign in again with one
   permanent test password.
9. Record only the commit SHA, account alias, synthetic username, role, site
   codes, sanitized result, and workflow/run evidence.

Never record the JWT, Cognito email, password, full AWS account ID, or
response headers containing credentials.

#### 10.6.9 Repeat, reset, and retire safely

- For another test role or site boundary, create a separate least-privilege
  synthetic identity. Do not repeatedly mutate one identity across concurrent
  test suites.
- If the password is lost or expired, run the allowlisted `reset-password`
  operation and complete the recovery through the project-controlled inbox.
- Before changing a mapping's immutable `sub`, stop: create a new mapping or
  correct the mistaken value through review. Never rebind an existing
  username silently.
- To suspend the account, remove or disable its application mapping first,
  then run `disable` and `global-sign-out`.
- To retire it, also run `remove-from-group` for
  `synthetic-test-users`, remove its mapping, restart/redeploy the backend,
  and verify that `/api/v1/me` is denied.

The administration workflow intentionally cannot create users, set a known
password, authenticate as the synthetic user, or permanently delete it.

## 11. Controlled user administration

All administration workflows run from `main`, check the repository allowlist
before obtaining AWS credentials, and target users by immutable `sub`.

| Operation | `cognito_sub` | `group` | Exact confirmation |
|---|---|---|---|
| `list-users` | blank | blank | blank |
| `list-groups` | blank | blank | blank |
| `inspect` | required | blank | blank |
| `enable` | required | blank | `enable zctiong <sub>` |
| `disable` | required | blank | `disable zctiong <sub>` |
| `reset-password` | required | blank | `reset-password zctiong <sub>` |
| `global-sign-out` | required | blank | `global-sign-out zctiong <sub>` |
| `add-to-group` | required | `developers` or `synthetic-test-users` | `add-to-group zctiong <sub>` |
| `remove-from-group` | required | `developers` or `synthetic-test-users` | `remove-from-group zctiong <sub>` |

The workflow cannot create or delete users, set a password, change user
attributes, authenticate as a user, or change pool/client/domain/group
definitions.

### 11.1 Offboard a developer

Perform these steps in order:

1. Remove or disable the CrewSafe database/runtime mapping.
2. Run `disable` for the Cognito `sub`.
3. Run `global-sign-out` for the same `sub`.
4. Run `remove-from-group` for `developers`.
5. Remove any `synthetic-test-users` membership if present.
6. Verify the next `/api/v1/me` request is denied.
7. Record sanitized workflow run IDs.

Never permanently delete the identity through repository automation.

## 12. Phase I — Developer verification

### 12.1 Workstation prerequisites

Install and verify:

- GitHub CLI authenticated to the repository;
- `jq`;
- either Podman with Podman Compose, or Docker Engine/Docker Desktop with
  Docker Compose v2;
- Node.js and npm;
- the Java version pinned by the backend;
- `curl`.

AWS CLI credentials, AWS profiles, local Terraform, and a local Cognito
emulator are not required.

### 12.2 Start CrewSafe against shared Cognito

From a fresh clone:

```bash
gh auth status

# Choose one:
./run.sh --account zctiong
./run-docker.sh --account zctiong
```

Both launchers:

1. retrieves `CREWSAFE_SHARED_COGNITO_JSON` through authenticated GitHub CLI;
2. validates the selected account entry;
3. exports backend Cognito issuer, JWKS, client and application-user settings;
4. creates the local web runtime settings;
5. starts only local PostgreSQL, backend, and web processes;
6. does not execute Terraform, access AWS APIs, or start local Cognito.

If the backend reports `Connection to localhost:5434 refused`, its local
PostgreSQL container is not running. Stop the active launcher and start it
again with the same engine. For inspection, use `podman ps -a` or
`docker ps -a` as appropriate. Do not use `--reset` merely to restart a stopped
container.

### 12.3 Acceptance checks

Each tester verifies:

- the Hosted UI opens;
- managed login succeeds;
- logout redirects to `http://localhost:5173/`;
- `/api/v1/me` returns the expected CrewSafe role and sites;
- an authenticated but unmapped `sub` is denied;
- a mapped user cannot access an unassigned site;
- no AWS credential or local Cognito process is required;
- representative `/api/v1/me` response time meets the one-second target,
  excluding interactive login.

Two developers other than the infrastructure implementer must repeat the
journey from fresh clones.

## 13. Account switching

To use another teammate's AWS credits:

1. Complete SCRUM-155 onboarding for the new account.
2. Add Cognito plan/apply permissions to that account's roles.
3. Add a new alias to `CREWSAFE_AWS_ACCOUNTS_JSON`.
4. Add approved actors under that alias in `.github/cognito/admins.json`.
5. Plan and apply `cognito-shared-dev` for that alias.
6. Add a separate account object to `CREWSAFE_SHARED_COGNITO_JSON`.
7. Select the same alias in plan, apply, administration, and local runtime:

```bash
# Podman
./run.sh --account <new-alias>

# Docker
./run-docker.sh --account <new-alias>
```

Never reuse another alias's run ID, state, pool ID, client ID, user, token, or
group membership. Never copy or migrate Cognito state or user data between
accounts.

## 14. Failure and recovery

### 14.1 General rule

For any failed plan, apply, verification, or administration action:

1. Stop further applies for the alias and component.
2. Preserve the failed run URL and sanitized error.
3. Determine whether the failure happened before or after AWS mutation.
4. Inspect AWS and remote state read-only through approved workflows or AWS
   Console.
5. Prepare a new reviewed plan or explicit recovery procedure.
6. Do not reuse, edit, or locally apply the old plan.

### 14.2 Common failures

| Symptom | Likely cause | Safe response |
|---|---|---|
| `Not authorized to perform sts:AssumeRoleWithWebIdentity` | Account/provider/audience mismatch, or the Cognito role still trusts the legacy name-only `sub` instead of the repository's immutable ID-bound `sub` | Compare the Cognito role with the working SCRUM-155 plan role. Set `CREWSAFE_GITHUB_OIDC_MAIN_SUBJECT` to the exact ID-bound value, merge the fix, create and apply a fresh `cognito-shared-dev` plan, then retry administration; do not edit the Terraform-managed role or add a wildcard |
| `Unknown account alias` | Alias missing from `CREWSAFE_AWS_ACCOUNTS_JSON` | Correct the repository variable and generate a new plan |
| Cognito or IAM `AccessDenied` during plan/apply | Canonical Cognito policy not attached to the selected role | Attach the reviewed policy in AWS Console, then create a new plan |
| Destroy fails on `iam:ListInstanceProfilesForRole` after Cognito resources disappear | The apply role is missing the provider-required pre-delete read; the destroy partially completed and left the administration role | Follow section 14.4; do not reuse the mutated destroy plan or manually delete the Terraform-managed role |
| Backend initialization or lock failure | SCRUM-155 backend incomplete, wrong bucket, state key, or active lock | Follow the SCRUM-155 runbook; do not force-unlock without confirming ownership |
| Plan is expired, altered, reused, or from the wrong attempt | Saved-plan metadata guard rejected it | Discard it and generate a new plan |
| Apply succeeded but deployment verification failed | Partial apply, service propagation, or boundary mismatch | Stop; inspect AWS and remote state read-only, then review reconciliation |
| Administrator actor rejected | Actor not allowlisted for the selected alias or file not merged to `main` | Correct `.github/cognito/admins.json` through review |
| Shared configuration rejected | Missing field, wrong URL, duplicate user/sub, PII-like `sub`, or wrong group order | Correct `CREWSAFE_SHARED_COGNITO_JSON`; never bypass the resolver |
| Hosted UI callback error | Wrong web client or callback/logout URL | Confirm `crewsafe-web` and the reviewed localhost URLs |
| Login succeeds but `/api/v1/me` is denied | Missing/inactive application mapping or wrong immutable `sub` | Verify the non-sensitive mapping and server-side authorization |
| Issuer or JWKS unavailable | Cognito service/domain issue or stale pool ID | Stop authentication tests and wait or correct configuration; do not switch to a local issuer |

### 14.3 Recover from provider read-back `AccessDenied` after partial creation

Use this procedure when Terraform reports that a Cognito user pool or
`CrewSafeGitHubCognitoAdminRole` was being created and then fails while reading
it back, for example on `cognito-idp:GetUserPoolMfaConfig` or
`iam:ListAttachedRolePolicies`.

The failed apply might already have created AWS resources and written partial
resource information to remote state. Treat both AWS and remote state as
authoritative evidence until a new plan proves their relationship.

1. Stop all `cognito-shared-dev` applies for the selected account alias.
2. Record only the failed apply URL, source plan run ID and attempt, commit,
   account alias, component, denied action, and timestamp. Do not copy state,
   credentials, full account IDs, or request payloads.
3. Do not delete the user pool or IAM role in AWS Console. Do not run
   Terraform locally, edit remote state, or retry the old saved plan. An apply
   failure does not make its reviewed plan safe to reuse after AWS mutation or
   an IAM policy change.
4. Prepare, review, and merge the repository policy correction first. The
   canonical documents are:
   - `infra/terraform/cognito/iam/plan-role-policy.json`;
   - `infra/terraform/cognito/iam/apply-role-policy.json`.
5. After that correction is on `main`, open **IAM → Roles →
   `CrewSafeGitHubTerraformPlanRole` → Permissions**. Edit the existing
   `CrewSafeCognitoTerraformPlan` inline policy and replace its JSON with the
   complete canonical plan-role policy from `main`.
6. Open **IAM → Roles → `CrewSafeGitHubTerraformApplyRole` → Permissions**.
   Edit `CrewSafeCognitoTerraformApply` and replace its JSON with the complete
   canonical apply-role policy from `main`.
7. Verify that both policies contain
   `cognito-idp:GetUserPoolMfaConfig` and
   `iam:ListAttachedRolePolicies`; verify that only the apply policy contains
   `cognito-idp:SetUserPoolMfaConfig`. Confirm the forbidden user/password
   operations in section 4 remain absent.
8. Wait briefly for IAM propagation, then run a new **Terraform Plan** from
   `main` for the same alias, component `cognito-shared-dev`, and operation
   `apply`. Do not supply or reuse the failed plan run ID.
9. Review the fresh plan:
   - if it refreshes the existing pool and role and proposes only the remaining
     expected resources or no changes, review and apply this new plan normally;
   - if it proposes creating `crewsafe-shared-dev` or
     `CrewSafeGitHubCognitoAdminRole` even though that object already exists,
     stop without applying. The failed create was not reconciled into state;
   - if refresh still returns `AccessDenied`, stop and compare the selected
     account, assumed role, inline policy names, and complete canonical JSON.
10. For an existing-object/state mismatch, open a recovery issue and prepare a
    reviewed GitHub Actions-only import or state-reconciliation procedure for
    the exact resource. Do not import locally and do not delete the AWS object
    merely to make a create plan pass.
11. After a successful apply, run another fresh plan and require no changes
    before continuing with user onboarding.

Operators must identify and record a safe recovery decision within 30 minutes.

### 14.4 Recover from `ListInstanceProfilesForRole` after partial destroy

Use this procedure when the destroy log shows that the user pool, domain,
clients, groups, and inline administration policy were destroyed, then fails
while deleting `CrewSafeGitHubCognitoAdminRole` because
`iam:ListInstanceProfilesForRole` is denied.

The failed destroy already mutated AWS and remote state. Its saved plan is
stale even if the applied-plan marker was not written.

1. Stop all `cognito-shared-dev` operations for the selected alias.
2. Record the failed apply URL, source destroy-plan run ID and attempt, commit,
   alias, denied action, and timestamp without copying credentials, state, full
   account IDs, or request payloads.
3. In AWS Console, confirm the expected partial result: the Cognito pool and
   its dependent resources are absent, while
   `CrewSafeGitHubCognitoAdminRole` remains.
4. Do not rerun the old destroy plan, delete the remaining role manually,
   modify remote state, or run Terraform locally.
5. Review and merge the repository correction that adds only
   `iam:ListInstanceProfilesForRole` to
   `infra/terraform/cognito/iam/apply-role-policy.json`.
6. After that correction is on `main`, replace the complete
   `CrewSafeCognitoTerraformApply` inline policy on
   `CrewSafeGitHubTerraformApplyRole` with the canonical apply-role policy from
   `main`. Do not add the read to the plan role.
7. Verify the apply policy still excludes
   `iam:RemoveRoleFromInstanceProfile`, `iam:DeleteInstanceProfile`, and
   `iam:AddRoleToInstanceProfile`. The administration role is not expected to
   belong to any EC2 instance profile. If an association is discovered, stop
   and investigate it instead of broadening the policy or removing it.
8. Wait briefly for IAM propagation, then generate a fresh **Terraform Plan**
   from `main` for the same alias, component `cognito-shared-dev`, and
   operation `destroy`.
9. Review the fresh plan. It should destroy only the remaining managed
   administration role and any harmless Terraform-only guard still present.
   Stop if it proposes an unexpected resource, another account, or a create or
   replacement.
10. Apply the fresh saved plan with
    `DESTROY <alias> cognito-shared-dev`. Never supply the failed plan's run ID
    or attempt.
11. Generate one more fresh `destroy` plan and require no remaining managed
    resources before removing stale shared configuration or allowlist entries.
12. Restore Cognito deletion protection to `ACTIVE` in repository code through
    review so any future shared pool is protected by default.

## 15. Audit and periodic access review

### 15.1 Per-operation audit

For each plan, apply, or administration action, record only:

- date and time;
- GitHub actor;
- account alias;
- operation and sanitized outcome;
- GitHub run URL/ID;
- reviewer where applicable;
- related commit SHA.

Correlate administration runs with CloudTrail events from
`cognito-idp.amazonaws.com`. Do not copy CloudTrail fields containing user
attributes into Jira.

### 15.2 Monthly review

Once a month and before account handoff:

1. Run `list-users`.
2. Run `list-groups`.
3. Compare immutable `sub`, status, creation time and approved group names
   with the current non-sensitive application mappings.
4. Confirm each enabled developer still needs access.
5. Confirm every group membership is approved.
6. Offboard stale or unexplained identities in the order from section 11.
7. Review `.github/cognito/admins.json`.
8. Remove obsolete GitHub actors through a pull request.
9. Record counts and decisions without recording email or attributes.

## 16. Controlled teardown

Deletion protection prevents direct pool destruction.

1. Confirm no developer or test depends on the selected pool.
2. Review a Terraform change that sets deletion protection inactive.
3. Plan and apply that change through the standard workflows.
4. Generate a separate `destroy` plan for `cognito-shared-dev`.
5. Review the complete destroy plan.
6. Apply it with:

```text
DESTROY <alias> cognito-shared-dev
```

7. Confirm the reviewed destroy succeeds.
8. Only then remove the alias's stale shared configuration and administrator
   allowlist entries through review.

Never delete a managed pool manually while remote state still owns it.

## 17. Acceptance evidence template

Do not record email, password, temporary password, token, full AWS account ID,
Terraform state, saved plan contents, or CloudTrail request payloads.

Use one copy per independent developer:

```text
Tester:
Date:
Commit SHA:
Account alias:
SCRUM-155 no-change plan URL:
Cognito plan URL / run ID / attempt:
Cognito apply URL:
Cognito no-change plan URL:
Configuration retrieval seconds:
Application startup: PASS/FAIL
Managed login: PASS/FAIL
/api/v1/me seconds and result: PASS/FAIL
Unknown-sub denial: PASS/FAIL
Cross-site denial: PASS/FAIL
Administration workflow run IDs:
Recovery exercise and safe-decision time:
Notes (sanitized):
```

Targets:

- shared configuration retrieval completes within 30 seconds;
- representative authenticated `/api/v1/me` completes within one second,
  excluding interactive login;
- an allowed administration workflow completes within five minutes, excluding
  GitHub queue time;
- an operator identifies a safe recovery action within 30 minutes.
