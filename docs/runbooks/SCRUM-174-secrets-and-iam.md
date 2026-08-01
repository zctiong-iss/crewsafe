# SCRUM-174 Secrets and IAM Runbook

**Component**: `secrets-shared-dev` · **Root**: `infra/terraform/secrets` · **State key**:
`crewsafe/secrets/shared-dev.tfstate` · **Destroy**: refused (`allow_destroy: false`)

**Plan**: [SCRUM-174-secrets-and-iam-plan.md](../plans/SCRUM-174-secrets-and-iam-plan.md)

This runbook covers attaching the IAM policies, dispatching plan and apply, writing the one
secret value, and rotating it.

> **Never run Terraform against a real account from a workstation** (AGENTS.md §3). Everything
> that touches AWS here is either a CI dispatch or a single scoped AWS CLI call.

## 1. What this procedure creates

| Resource | Count | Note |
| --- | --- | --- |
| Secrets Manager secret container | 1 | `crewsafe/shared-dev/weather-api-key`, **created empty** |
| SSM parameters (type `String`) | 6 | Under `/crewsafe/shared-dev/` |
| IAM roles | 2 | `crewsafe-shared-dev-task-execution`, `crewsafe-shared-dev-task` |
| Inline role policies | 2 | One per role |

**11 resources.** No KMS key, no secret version, and neither the database URL nor the CORS
origins parameter — each absent by design, not by omission (FR-031).

## 2. Prerequisites and sequencing

### The component must be on `main` first

Both `Terraform State Plan` and `Terraform State Apply` run `if: github.ref == 'refs/heads/main'`
and check out the default branch. A component on a feature branch is invisible to them.

### Order of operations

1. Merge the pull request registering the component.
2. Attach the IAM policies (§3) — **before** the first plan, or it fails on `AccessDenied`.
3. Confirm `cognito-shared-dev` has been applied in the target account. This component reads its
   state; without it, `terraform init` fails resolving the remote state data source.
4. Dispatch plan (§4), review (§5), apply (§6).
5. Write the weather API key value (§7). Optional — the application treats it as optional.

### Also required

- The account alias must be registered in `CREWSAFE_AWS_ACCOUNTS_JSON`.
- The state bucket `crewsafe-terraform-state-<ACCOUNT_ID>-ap-southeast-1` must exist (SCRUM-155).

## 3. Attach the IAM policies

These are hand-applied documents, not Terraform-managed resources — the same manual step the
SCRUM-154, SCRUM-155, and SCRUM-173 runbooks describe.

| Role | Inline policy name | Document |
| --- | --- | --- |
| `CrewSafeGitHubTerraformPlanRole` | `CrewSafeSecretsTerraformPlan` | [`iam/plan-role-policy.json`](../../infra/terraform/secrets/iam/plan-role-policy.json) |
| `CrewSafeGitHubTerraformApplyRole` | `CrewSafeSecretsTerraformApply` | [`iam/apply-role-policy.json`](../../infra/terraform/secrets/iam/apply-role-policy.json) |

> **The policy name is load-bearing. Get it exactly right.** Attaching an inline policy is an
> **upsert**: saving one whose name already exists silently *replaces* it, with no warning and no
> error. Both roles are shared across every component and already carry
> `CrewSafeCognitoTerraformPlan`/`Apply` (SCRUM-154), `CrewSafeNetworkTerraformPlan`/`Apply`
> (SCRUM-173), and the SCRUM-155 state-backend policies. Reusing one of those names here deletes
> that component's permissions, and the damage surfaces later as an unrelated-looking
> `AccessDenied` on *its* next plan — not on anything you did.
>
> Nothing in CI validates these names; only the **role** names are enforced
> (`resolve-terraform-account.sh:44-45` regex-matches the ARNs). The convention
> `CrewSafe<Component>Terraform<Plan|Apply>` is the only thing keeping them distinct.

Replace `<ACCOUNT_ID>` in the apply policy with the target account's twelve-digit id before
attaching. It appears once, in the `ManageTaskIdentities` statement's resource.

### 3.1 Update the plan role

1. In the AWS Console, open **IAM → Roles**.
2. Select `CrewSafeGitHubTerraformPlanRole`.
3. Open **Permissions → Add permissions → Create inline policy**.
4. Select the **JSON** editor.
5. Copy the complete reviewed document from
   `infra/terraform/secrets/iam/plan-role-policy.json`.
6. Confirm it contains three read-only statements — `ReadSecretContainersPlan`,
   `ReadConfigurationParametersPlan`, `ReadIdentitiesPlan` — and **no**
   `secretsmanager:GetSecretValue`.
7. Name the policy `CrewSafeSecretsTerraformPlan`.
8. Save the policy.

The plan role must not receive any create, update, delete, or tag permission on either store.

### 3.2 Update the apply role

1. Return to **IAM → Roles**.
2. Select `CrewSafeGitHubTerraformApplyRole`.
3. Open **Permissions → Add permissions → Create inline policy**.
4. Select the **JSON** editor.
5. Copy the complete reviewed document from
   `infra/terraform/secrets/iam/apply-role-policy.json`.
6. Confirm it contains the read statement plus `ManageSecretContainers`,
   `ManageConfigurationParameters`, and `ManageTaskIdentities` — and **no**
   `secretsmanager:GetSecretValue`.
7. Confirm `ManageTaskIdentities` is scoped to
   `arn:aws:iam::<ACCOUNT_ID>:role/crewsafe-shared-dev-*` with the real account id substituted,
   not `*`. This is the one statement here where a resource scope is both available and
   meaningful, so it is used.
8. Name the policy `CrewSafeSecretsTerraformApply`.
9. Save the policy.

Do not widen either policy to `secretsmanager:*` or `ssm:*`. Each action is a reviewed addition.

> **Neither policy grants `secretsmanager:GetSecretValue`, and neither ever should.** The CI
> roles create and describe containers; they can never read a value. This is a second,
> independent guarantee that a plan diff cannot contain a credential — it does not depend on the
> source guard being correct. The source guard asserts the omission and has been observed
> catching its violation.

`ssm:GetParameter` **is** granted, because the configuration parameters are non-secret by
classification and Terraform must read them to detect drift. That asymmetry between the two
stores is the point of the classification, not an oversight.

> **Inline policy budget.** A role's inline policies share a 10,240-character limit. After this
> component the apply role is at roughly **5,100** characters across four policies, the plan role
> at roughly **2,500**. There is room, but the database and compute components still have to fit
> — if the apply role approaches the limit, the fix is a customer-managed policy per component
> attached to the role, not trimming a reviewed statement.

## 4. Plan

Dispatch **Terraform State Plan** from `main`:

| Input | Value |
| --- | --- |
| `target_account_alias` | the designated shared-dev alias |
| `terraform_component` | `secrets-shared-dev` |
| `operation` | `apply` |

No extra variables are needed, and that is a deliberate property rather than a convenience.
`expected_account_id`, `account_alias`, and `aws_region` come from the account registry;
`database_username` and `secret_recovery_window_days` have working defaults.

> An earlier version of this component had a required `cors_allowed_origins` whose default
> (`[]`) could not pass its own validation, so **every dispatch failed** with
> `Invalid value for variable`. The lesson generalises: a variable whose value is produced by a
> component that does not exist yet must not be an input here at all — the entry belongs to the
> producing component (FR-031). If you add a variable to this component, check that a dispatch
> with no extra inputs still plans.

Record the **run id**; the apply workflow requires it.

## 5. Review the plan — five mandatory checks

A clean plan does not prove every constraint. `validate`, the mocked tests, and the plan itself
can all pass while a server-side rule is violated — the lesson SCRUM-173 paid for with a
half-applied network. Read the plan output for these:

1. **No `secret_string` appears anywhere.** The secret shows `name`, `description`,
   `recovery_window_in_days`, and tags — and no value. A version resource must not appear at all.
2. **Every parameter shows `type = "String"`.** Never `SecureString`.
3. **No credential-looking value anywhere in the output.** Read it; do not assume.
4. **The account precondition resolved to the designated account.** The mocked tests pin a fake
   account id, so this is the first time the real one is checked.
5. **11 resources to add, 0 to change, 0 to destroy.** An unexpected addition is scope
   creep the assertions cannot see.

## 6. Apply

Dispatch **Terraform State Apply** from `main` with the successful `plan_run_id` and the typed
confirmation `APPLY <alias>`. It applies exactly the reviewed plan.

Then confirm no credential is in state:

```bash
# Must show the container's metadata and no value.
terraform show    # via the workflow, not locally
```

## 7. Write the weather API key value

The container is created empty. The value is written **out of band — never through Terraform**:

```bash
aws secretsmanager put-secret-value \
  --secret-id crewsafe/shared-dev/weather-api-key \
  --secret-string file:///path/to/key.txt   # a file, not an inline argument
```

> Pass the value via `file://` or a prompt, never as an inline shell argument — an inline value
> lands in shell history and in process listings.

The application treats this key as optional: without it, data.gov.sg applies unauthenticated
rate limits. An empty container is a valid steady state.

### Then confirm values and definitions are genuinely separated

Dispatch the plan workflow again. It **must report no changes**.

If it shows a diff, the design is wrong. **Do not "fix" it by adding `ignore_changes`** — the
source guard forbids that for exactly this reason, and the suppression would hide genuine drift
on the same field.

## 8. Rotation

### Blast radius — read this before writing

- The new value is live for **every task started after the write**.
- **Tasks already running keep the old value until they are replaced.** Rotation is not
  instantaneous everywhere. Replace the tasks to complete it.
- No Terraform run, no repository change, no container image build, and no pull request is
  involved. That is the design (FR-016), and it is what makes a 2am rotation a five-minute job.

### Procedure

1. Write the new value with `put-secret-value` as in §7.
2. Replace running tasks (force a new deployment) so they pick it up.
3. Dispatch a plan and confirm it reports no changes.

### The database credential rotates without anyone asking

The managed database service may rotate the master password **on its own schedule, with no
operator action at all**. A running task can therefore be holding a superseded password through
nobody's doing.

Symptom: authentication failures from a task that was working. Recovery: **replace the task**,
not edit a secret. There is nothing to fix in Secrets Manager — the current value is already
correct; the task is holding a stale copy.

## 9. Consuming this component

```hcl
data "terraform_remote_state" "secrets" {
  backend = "s3"
  config = {
    bucket = "crewsafe-terraform-state-${var.expected_account_id}-${var.aws_region}"
    key    = "crewsafe/secrets/shared-dev.tfstate"
    region = var.aws_region
  }
}
```

| Output | Use |
| --- | --- |
| `weather_api_key_secret_arn` | Task definition `secrets` block |
| `config_parameter_prefix` | Where parameters live; where the database component writes the URL |
| `task_execution_role_arn` | `executionRoleArn` |
| `task_role_arn` | `taskRoleArn` |
| `task_execution_role_name` | Attaching a pinned credential grant later |

### Rules a consumer must not break

| Rule | What breaks if ignored |
| --- | --- |
| Reference secrets in `secrets`, never `environment` | The credential becomes readable by anyone who can `DescribeTaskDefinition` — this defeats every control in this component |
| Never append a version id to a `valueFrom` ARN | Rotation stops taking effect without a task-definition change |
| Attach exactly these two roles; add no broad managed policy | Restores the account-wide access this component removes |
| Create parameters under `config_parameter_prefix` only | Outside the read grant — the task fails to start |
| The database component must enable the service-managed master password | A `random_password` there puts the credential in that component's state |
| The component creating the web origin must create `<prefix>/cors/allowed-origins` | The deployed API grants no cross-origin access until it exists — correct today, wrong once a web app is deployed |
| Never pass a credential as a container build argument | Build arguments persist in image metadata |

## 10. Destroy

**Refused.** `resolve-component.sh` rejects a destroy dispatch for this component before any
credential is assumed, because the database and compute components depend on it.

Destroying it would orphan every running task's configuration while leaving the secrets
themselves in a pending-deletion state — recoverable, but only within the 7-day window.

## 11. Operational notes and known limitations

- **Deleted secrets are recoverable for 7 days.** Within that window,
  `aws secretsmanager restore-secret --secret-id <name>` undoes it. After it, the value is gone
  and the name becomes reusable. A secret pending deletion still holds its name, which is a real
  and annoying failure mode if you try to recreate it.
- **The application cannot start until SCRUM-175 lands.** `DB_URL` does not exist until the
  database component creates it under this component's prefix. A task will fail at startup
  naming the missing datasource setting. **Diagnose that as expected sequencing, not as a
  permissions fault** — the application also cannot start without a database.
- **A missing entry fails fast by design.** `application.yml` deliberately gives the Cognito
  settings no default, so a deployment that forgets one dies at startup naming the property
  rather than quietly falling back to a developer machine's configuration.
- **One grant reaches outside this component's naming scope**: `secretsmanager:GetSecretValue`
  on `rds!*`, because the database service names its own secret and it does not exist until the
  database does. AWS reserves the `rds!` prefix, so no customer secret can occupy it. Once the
  database exists, its component can attach a precisely pinned grant to
  `task_execution_role_name` and narrow this.
- **One statement uses `Resource: "*"`**: `ecr:GetAuthorizationToken`, which the ECR API accepts
  no resource scope for. AWS's own `AmazonECSTaskExecutionRolePolicy` is written the same way.
  It is held to one action in one statement, and a test asserts all three of those facts.
- **The role trust policies carry no `aws:SourceArn` condition.** Pinning the trust to a specific
  ECS cluster is the right hardening, but that cluster does not exist yet. The compute component
  should add it.
