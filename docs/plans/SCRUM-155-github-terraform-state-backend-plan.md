# SCRUM-155 — GitHub Terraform State Backend Plan

**Status:** Approved for implementation
**Saved:** 2026-07-28
**Parent:** SCRUM-142 — Provision cloud staging infrastructure and secrets management
**Blocks:** SCRUM-154 — Provision AWS Cognito test and staging infrastructure with Terraform

## Summary

Provision a secure Terraform remote-state backend entirely through GitHub Actions.
Developers do not install or run Terraform locally, use local AWS profiles, or retain
Terraform state on their workstations.

Each teammate may provide a separate credit-bearing AWS account. GitHub CI/CD selects the
target through a registered account alias, authenticates using GitHub OIDC, and provisions
an isolated backend in that account:

```text
crewsafe-terraform-state-<AWS_ACCOUNT_ID>-ap-southeast-1
```

State is never shared or migrated between teammates' accounts. Switching accounts means
selecting a different registered account alias for all Terraform operations.

## 1. Spec Kit and repository workflow

1. Create `feat/scrum-155-terraform-state-backend` from `main`.
2. Keep Spec Kit local:
   - Ignore `/specs/`, `.specify/`, and installed Spec Kit skills.
   - Ignore Terraform state, plans, caches, crash logs, and generated backend files.
   - Continue tracking `.terraform.lock.hcl`.
3. Generate local `specs/001-terraform-state-backend/` artifacts:
   - `speckit-specify`
   - `speckit-clarify`, recording the multi-user account model
   - `speckit-plan`
   - `speckit-tasks` with Terraform, workflow, and account-isolation tests
   - `speckit-analyze`, resolving all critical and high findings
   - `speckit-implement`
4. Implement:
   - credential-free pull-request validation;
   - manual account-specific plan workflow;
   - manual apply workflow using the exact reviewed plan;
   - reusable account resolution for subsequent Terraform roots.
5. Merge the implementation before executing a real AWS plan or apply. OIDC roles trust
   only workflows running from `main`.
6. Keep SCRUM-154 blocked until SCRUM-155 succeeds for the account selected to host
   Cognito.

Generated Spec Kit artifacts are not committed. The pull request contains only the
Terraform configuration, GitHub workflows, operational documentation, ignore rules, and
the Terraform dependency lock file.

## 2. Account registry and AWS authentication

### Repository account registry

Create one repository-level GitHub Actions variable:

```text
CREWSAFE_AWS_ACCOUNTS_JSON
```

Its value maps a stable team-member alias to account configuration:

```json
{
  "member-alias": {
    "account_id": "123456789012",
    "region": "ap-southeast-1",
    "plan_role_arn": "arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformPlanRole",
    "apply_role_arn": "arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformApplyRole"
  }
}
```

Rules:

- Account aliases use lowercase letters, digits, and hyphens.
- AWS profile names are never stored.
- Account IDs and role ARNs remain GitHub configuration rather than repository source.
- Adding or replacing an AWS account requires updating the repository variable, not
  Terraform or workflow code.
- Removing an alias prevents new plans and applies to that account.
- A workflow rejects aliases not present in the registry.
- Passwords, access keys, session tokens, and credit details are never stored.

There is no `TERRAFORM_APPLY_APPROVERS` variable or maintained apply-approver list.

### AWS OIDC roles

Each teammate configures one GitHub OIDC provider and two roles in their AWS account:

- `CrewSafeGitHubTerraformPlanRole`
  - permits STS identity verification and read-only inspection;
  - cannot create, update, or delete infrastructure.
- `CrewSafeGitHubTerraformApplyRole`
  - initially has only the S3 permissions required by SCRUM-155;
  - is expanded for later Terraform roots only through reviewed changes.

Both roles trust:

```text
Provider: token.actions.githubusercontent.com
Audience: sts.amazonaws.com
Subject: repo:zctiong-iss@<OWNER_ID>/crewsafe@<REPO_ID>:ref:refs/heads/main
```

GitHub Actions uses OIDC-issued short-lived credentials. No IAM user or long-lived AWS
access key is created for GitHub.

## 3. Terraform design

The Terraform root is stored under:

```text
infra/terraform/bootstrap/state/
```

It:

- requires Terraform `>= 1.10, < 2.0`;
- uses HashiCorp AWS provider `~> 6.0`;
- accepts `expected_account_id`, `account_alias`, and `aws_region`;
- requires a 12-digit expected account ID;
- requires Region `ap-southeast-1`;
- obtains the caller through `data.aws_caller_identity.current`;
- fails before resource changes when the caller differs from `expected_account_id`;
- derives the bucket name from the verified account ID;
- creates S3 versioning;
- configures SSE-S3 encryption using `AES256`;
- configures `BucketOwnerEnforced` ownership;
- enables all four public-access-block settings;
- adds a bucket policy denying `aws:SecureTransport=false`;
- sets `force_destroy=false`;
- sets `lifecycle.prevent_destroy=true`;
- applies `Project=CrewSafe`, `ManagedBy=Terraform`, and
  `DeploymentAccount=<account_alias>` tags;
- uses Terraform's default local backend only for first-bootstrap plan/apply
  operations on ephemeral GitHub-hosted runners;
- generates a partial `backend "s3" {}` declaration and values only for
  managed-state operations and bootstrap migration;
- enables native S3 locking through `use_lockfile=true`;
- does not create deprecated DynamoDB locking.

The bootstrap state key is:

```text
crewsafe/bootstrap/terraform.tfstate
```

Future roots use the selected account's bucket with independent keys:

```text
crewsafe/cognito/test.tfstate
crewsafe/cognito/staging.tfstate
crewsafe/<component>/<environment>.tfstate
```

The root exports:

- AWS account ID;
- bucket name;
- bucket ARN;
- backend Region;
- bootstrap state key.

## 4. GitHub CI/CD workflows

### Pull-request validation

The pull-request workflow receives no AWS credentials and does not request
`id-token: write`. It runs:

- `terraform fmt -check -recursive`;
- `terraform init` with the default local backend;
- `terraform validate`;
- mocked-provider `terraform test`;
- workflow and YAML linting;
- secret scanning;
- Terraform security scanning.

Forked or pull-request code cannot assume an AWS role.

### Manual plan

Inputs:

```text
target_account_alias
terraform_component=state-backend
```

The workflow:

1. Runs only from `main`.
2. Resolves the alias from `CREWSAFE_AWS_ACCOUNTS_JSON`.
3. Validates the JSON schema, account ID, Region, and role ARNs.
4. Assumes the selected account's plan role through GitHub OIDC.
5. Calls STS and requires the caller account to match the registry.
6. Derives the expected account-specific bucket.
7. Checks whether that bucket exists.
8. For a new account:
   - initializes the default local backend on the ephemeral runner;
   - creates a saved bootstrap plan from empty runner state.
9. For an existing managed account:
   - generates ephemeral backend configuration;
   - initializes against remote state;
   - creates a saved plan.
10. Records the plan actor, commit, account alias, account ID, bucket, Region, Terraform
    version, dependency-lock hash, plan checksum, and `bootstrap` or `managed` mode.
11. Publishes a sanitized human-readable summary.
12. Uploads the saved-plan bundle with one-day retention.

State and credentials are never uploaded.

### Manual apply

Inputs:

```text
target_account_alias
plan_run_id
confirmation
```

The confirmation must be exactly:

```text
APPLY <target_account_alias>
```

The workflow:

1. Runs only from `main`.
2. Requires the apply actor to differ from the plan actor.
3. Resolves the account registry again.
4. Downloads the plan artifact identified by `plan_run_id`.
5. Rejects an artifact that:
   - did not come from the plan workflow;
   - is older than one day;
   - targets another alias or component;
   - references a commit not present on `main`;
   - has a different dependency-lock hash;
   - fails its plan checksum;
   - has already been applied.
6. Checks out the exact planned commit.
7. Assumes the selected account's apply role through GitHub OIDC.
8. Repeats the STS account check.
9. Initializes Terraform according to the recorded mode.
10. Applies the exact saved plan without replanning.
11. For first-time bootstrap:
    - writes an encrypted temporary recovery state object inside the new protected bucket;
    - migrates runner state to the canonical bootstrap key;
    - verifies the canonical state;
    - removes the recovery object only after successful verification.
12. Verifies S3 controls, remote state access, locking, and a final no-change plan.
13. Publishes sanitized evidence without state or credentials.

The workflow uses a non-cancelling concurrency group based on account alias and component
to prevent simultaneous state writers.

All external GitHub Actions are pinned to verified immutable commit SHAs. Permissions are
limited to `contents: read`, `id-token: write`, and `actions: read` where required.

## 5. Manual operator guide

### A. Onboard a teammate's AWS account

1. Sign in to the teammate's AWS Console.
2. Confirm the account ID, promotional credits, and required service limits.
3. Open **IAM → Identity providers**.
4. Create or reuse the OpenID Connect provider:
   - Provider URL: `https://token.actions.githubusercontent.com`
   - Audience: `sts.amazonaws.com`
5. Create `CrewSafeGitHubTerraformPlanRole`.
6. Create `CrewSafeGitHubTerraformApplyRole`.
7. Restrict both trust policies to:
   - `repo:zctiong-iss@<OWNER_ID>/crewsafe@<REPO_ID>:ref:refs/heads/main`
8. Give the plan role read-only inspection permissions.
9. Give the apply role only the S3 permissions required for:
   - the account-specific state bucket;
   - bucket security configuration;
   - state objects;
   - `.tflock` objects;
   - temporary migration recovery objects.
10. Do not create an IAM user or AWS access key for GitHub.
11. Record the account ID and both role ARNs.

### B. Register the account in GitHub

1. Open the CrewSafe repository.
2. Go to **Settings → Secrets and variables → Actions → Variables**.
3. Open `CREWSAFE_AWS_ACCOUNTS_JSON`.
4. Add a stable lowercase alias for the teammate.
5. Add the account ID, `ap-southeast-1`, plan role ARN, and apply role ARN.
6. Validate that the complete value is valid JSON.
7. Save the variable.
8. Do not store passwords, keys, tokens, or credit information.

### C. Generate the Terraform plan

1. Confirm the SCRUM-155 implementation is merged into `main`.
2. Open **Actions → Terraform Plan**.
3. Select **Run workflow**.
4. Select `main`.
5. Enter the registered account alias.
6. Select `state-backend`.
7. Run the workflow.
8. Confirm it assumed the intended account's plan role.
9. Review the account, Region, derived bucket, and resource summary.
10. Confirm there is no DynamoDB, Cognito, IAM user, access key, or unrelated resource.
11. Record the successful plan run ID.
12. Stop if the bucket exists but is not recognized as CrewSafe-managed.

### D. Apply the reviewed plan

A different teammate from the plan creator performs these steps:

1. Open **Actions → Terraform Apply**.
2. Select **Run workflow**.
3. Select `main`.
4. Enter the same account alias.
5. Enter the successful plan run ID.
6. Enter `APPLY <target_account_alias>`.
7. Verify the displayed account, commit, bucket, plan checksum, and resource summary.
8. Run the workflow.
9. Do not rerun a failure without reviewing its state and recovery evidence.

No maintained apply-approver list is required. Repository workflow access, the reviewed
plan artifact, exact confirmation, and different-actor check form the manual gate.

### E. Verify successful completion

Confirm the workflow proves:

1. State exists at `crewsafe/bootstrap/terraform.tfstate`.
2. Versioning is enabled.
3. AES256 server-side encryption is configured.
4. Ownership is bucket-owner enforced.
5. All four public-access-block settings are true.
6. Non-TLS access is denied.
7. Remote state read and write succeeds.
8. Native S3 lockfile operations succeed.
9. The final Terraform plan reports no changes.
10. No state, credentials, or tokens appear in logs or artifacts.
11. Temporary migration recovery state is removed after success.

### F. Switch to another teammate's AWS account

1. Complete account onboarding and GitHub registration for the other account.
2. Select its alias in the plan workflow.
3. Review and apply through the same process.
4. Use the same alias for Cognito and subsequent Terraform components.
5. Never share or migrate state between teammates' accounts.
6. Every account keeps its own backend and infrastructure.

### G. Failure and recovery

If bootstrap or migration fails:

1. Stop further applies for that account and component.
2. Do not rerun automatically.
3. Identify whether authoritative state is at the canonical key or protected recovery key.
4. Preserve the recovery object until the failure is understood.
5. Do not use `terraform state push`, forced migration, or `force-unlock` without a
   reviewed recovery plan.
6. Record the failed workflow and findings in SCRUM-155.
7. Resume only after a teammate confirms the recovery procedure.

### H. Complete Jira tracking

1. Add the merged pull-request link.
2. Add the successful plan workflow link.
3. Add the successful apply workflow link.
4. Record the selected account alias.
5. Confirm SCRUM-154 can use the same alias and backend.
6. Transition SCRUM-155 to Done only after all verification checks pass.

## 6. Acceptance criteria

- No developer workstation runs Terraform for SCRUM-155.
- Pull-request validation passes without AWS credentials.
- GitHub OIDC successfully assumes the selected account's plan and apply roles.
- Account mismatch causes the workflow to fail before Terraform runs.
- Mock tests prove different account IDs generate isolated bucket names.
- The selected account's S3 backend is reproducibly provisioned in
  `ap-southeast-1`.
- Versioning, encryption, ownership, public-access blocks, and TLS-only access are
  verified.
- Runner bootstrap state is migrated to `crewsafe/bootstrap/terraform.tfstate`.
- Terraform can lock, read, and update remote state through S3.
- A no-change plan succeeds after state migration.
- No Terraform state, AWS credentials, backend credentials, or tokens are committed or
  retained as long-lived artifacts.
- Another registered teammate account can be selected without changing Terraform or
  workflow source.
- SCRUM-154 backend instructions use the same account-alias mechanism.

## 7. Jira description update

When separately authorized, update the SCRUM-155 Jira description to reflect sections
**Summary**, **Account registry and AWS authentication**, **Terraform design**,
**GitHub CI/CD workflows**, **Manual operator guide**, and **Acceptance criteria** from
this plan.

Preserve:

- parent SCRUM-142;
- the structured `blocks SCRUM-154` relationship;
- assignee, priority, sprint, and status.

Remove obsolete statements that require:

- installing or running Terraform on a developer workstation;
- using a named local AWS profile;
- retaining or migrating developer-local state;
- maintaining `TERRAFORM_APPLY_APPROVERS`.

Jira is not changed as part of saving this plan.

## Assumptions

- Team-member AWS accounts are interchangeable development and demonstration targets,
  each funded by that member's AWS credits.
- One account alias is selected for an entire Terraform operation.
- A single Terraform root never spans multiple teammates' accounts.
- Each account owns its backend and provisioned infrastructure.
- Repository variables enable account switching without source changes.
- The plan and apply actors must be different, but there is no maintained approver list.
- No Terraform command or AWS profile is required on developer machines.
- Spec Kit tooling and generated artifacts remain local.
