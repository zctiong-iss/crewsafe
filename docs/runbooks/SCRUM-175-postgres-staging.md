# SCRUM-175 PostgreSQL Staging Runbook

**Component**: `database-shared-dev` · **Root**: `infra/terraform/database` · **State key**:
`crewsafe/database/shared-dev.tfstate` · **Destroy**: refused (`allow_destroy: false`, and again
by deletion protection)

**Plan**: [SCRUM-175-postgres-staging-plan.md](../plans/SCRUM-175-postgres-staging-plan.md)

This runbook covers attaching the IAM policies, dispatching plan and apply, reviewing the plan by
hand, restoring after data loss, and what an unannounced credential rotation looks like.

> **Never run Terraform against a real account from a workstation** (AGENTS.md §3). Everything
> that touches AWS here is a CI dispatch.

## 1. What this procedure creates

| Resource | Count | Note |
| --- | --- | --- |
| DB subnet group | 1 | Both private subnets, consumed from `network-shared-dev` |
| DB parameter group | 1 | One parameter: `rds.force_ssl = 1` |
| CloudWatch log group | 1 | `/aws/rds/instance/crewsafe-shared-dev/postgresql`, 7-day retention |
| RDS PostgreSQL 16 instance | 1 | `db.t4g.micro`, gp3, encrypted, single-AZ |
| SSM parameter | 1 | `/crewsafe/shared-dev/db/url`, type `String` |
| Inline IAM role policy | 1 | Attached to the **secrets component's** execution role |

**Six resources.** No security group, no secret container, no KMS key — each absent by design, not
by omission.

## 2. Prerequisites and sequencing

### The component must be on `main` first

Both `Terraform State Plan` and `Terraform State Apply` run `if: github.ref == 'refs/heads/main'`
and check out the default branch. A component on a feature branch is invisible to them.

### Order of operations

1. Merge the pull request registering the component.
2. Attach the IAM policies (§3) — **before** the first plan, or it fails on `AccessDenied`.
3. Confirm `network-shared-dev` **and** `secrets-shared-dev` have been applied in the target
   account. This component reads both states; without them `terraform init` fails resolving the
   data sources. **That failure is loud and correct — do not diagnose it as a permissions
   problem.**
4. Dispatch plan (§4), review it by hand (§5), apply (§6).
5. Verify (§7).

### Also required

- The account alias must be registered in `CREWSAFE_AWS_ACCOUNTS_JSON`.
- The state bucket `crewsafe-terraform-state-<ACCOUNT_ID>-ap-southeast-1` must exist (SCRUM-155).

## 3. Attach the IAM policies

Hand-applied documents, not Terraform-managed resources — the same manual step the SCRUM-154,
SCRUM-155, SCRUM-173, and SCRUM-174 runbooks describe.

| Role | Inline policy name | Document |
| --- | --- | --- |
| `CrewSafeGitHubTerraformPlanRole` | `CrewSafeDatabaseTerraformPlan` | [`iam/plan-role-policy.json`](../../infra/terraform/database/iam/plan-role-policy.json) |
| `CrewSafeGitHubTerraformApplyRole` | `CrewSafeDatabaseTerraformApply` | [`iam/apply-role-policy.json`](../../infra/terraform/database/iam/apply-role-policy.json) |

> **The policy name is load-bearing. Get it exactly right.** Attaching an inline policy is an
> **upsert**: saving one whose name already exists silently *replaces* it, with no warning and no
> error. Both roles are shared across every component and already carry
> `CrewSafeCognitoTerraformPlan`/`Apply` (SCRUM-154), `CrewSafeNetworkTerraformPlan`/`Apply`
> (SCRUM-173), `CrewSafeSecretsTerraformPlan`/`Apply` (SCRUM-174), and the SCRUM-155 policies.
> Reusing one of those names deletes that component's permissions, and the damage surfaces later
> as an unrelated-looking `AccessDenied` on *its* next plan — not on anything you did.
>
> Nothing in CI validates these names; only the **role** names are enforced. The convention
> `CrewSafe<Component>Terraform<Plan|Apply>` is the only thing keeping them distinct.

Replace `<ACCOUNT_ID>` in the apply policy with the target account's twelve-digit id before
attaching. It appears **twice**: in `ManageEngineLogGroup` and in `ManageNarrowingCredentialGrant`.

### 3.1 Update the plan role

1. In the AWS Console, open **IAM → Roles**.
2. Select `CrewSafeGitHubTerraformPlanRole`.
3. Open **Permissions → Add permissions → Create inline policy**, then the **JSON** editor.
4. Copy the complete reviewed document from `infra/terraform/database/iam/plan-role-policy.json`.
5. Confirm it contains four read-only statements — `ReadDatabasePlan`,
   `ReadConfigurationParametersPlan`, `ReadNarrowingPolicyPlan`, `ReadEngineLogGroupPlan` — and
   **no** `secretsmanager:GetSecretValue`.
6. Name the policy `CrewSafeDatabaseTerraformPlan` and save.

### 3.2 Update the apply role

1. Return to **IAM → Roles** and select `CrewSafeGitHubTerraformApplyRole`.
2. Create an inline policy from `infra/terraform/database/iam/apply-role-policy.json`.
3. Confirm `ManageNarrowingCredentialGrant` is scoped to
   `arn:aws:iam::<ACCOUNT_ID>:role/crewsafe-shared-dev-*` with the real account id substituted,
   not `*`.
4. Confirm `ManageEngineLogGroup` — the **mutating** log actions — is scoped to the log-group ARN
   pattern, not `*`.
5. Confirm `ListLogGroupsApply` holds **exactly one action**, `logs:DescribeLogGroups`, on `*`.
   **Do not "tighten" this to an ARN.** See the warning below.
6. Confirm it grants **no** `secretsmanager:GetSecretValue` and **no** `logs:GetLogEvents`.
7. Name the policy `CrewSafeDatabaseTerraformApply` and save.

> **`logs:DescribeLogGroups` accepts no resource scope, and scoping it fails the apply.** This
> policy originally folded it into `ManageEngineLogGroup` alongside the mutating actions, scoped to
> the log-group ARN pattern. That looked tighter and was simply wrong: the CloudWatch Logs API
> evaluates the action against `log-group::log-stream:` rather than the named group, so the request
> is denied. Apply run 30702539990 failed on exactly this, after creating the subnet group and the
> parameter group.
>
> It is the same shape as SCRUM-174's `ecr:GetAuthorizationToken` exemption: an action the service
> permits only on `*`, isolated into its own single-action statement so it cannot quietly acquire a
> second. Every mutating log action stays prefix-scoped.
>
> **Nothing in CI catches this.** `terraform validate`, the mocked tests, and the plan all accept a
> policy AWS will reject, because none of them knows which actions support resource-level
> permissions. It is a plan-review and first-apply discovery, which is why it is written down here.

> **Neither policy grants `secretsmanager:GetSecretValue`, and neither ever should.** The CI roles
> provision the instance; they can never read the credential the service manages. This is a
> second, independent guarantee that a plan diff cannot contain a credential — it does not depend
> on the source guard being correct. The source guard asserts the omission and has been observed
> catching its violation.
>
> Neither grants log **read** either. CI manages the log container and its retention, never its
> contents.

> **Inline policy budget.** A role's inline policies share a 10,240-character limit. After this
> component the apply role is at roughly **7,000** characters across five policies and the plan
> role at roughly **3,400**. There is room, but the compute component (SCRUM-176) still has to
> fit — if it is large, consider consolidating rather than discovering the limit mid-attachment.

## 4. Dispatch the plan

1. **Actions → Terraform State Plan → Run workflow** (from `main`).
2. `target_account_alias`: your alias.
3. `terraform_component`: `database-shared-dev`.
4. Note the **run id** — the apply requires it.

Expect **6 to add, 0 to change, 0 to destroy** on a first run.

## 5. Review the plan by hand — mandatory

**A clean plan does not prove every server-side constraint is met.** This is SCRUM-173's
hardest-won lesson: its apply failed midway because a security group description contained an
apostrophe, which `validate`, the mocked tests, and the plan all accepted.

None of the following is visible to `terraform validate`, to the mocked tests, or to the resource
count. Read each from the plan output:

- [ ] `publicly_accessible` is **false**. *A publicly accessible instance in a private subnet
      still receives a public endpoint, and no security group rule prevents reaching it.*
- [ ] `port` is **5432**. *The only port the network component's ingress rule admits.*
- [ ] `db_subnet_group_name` resolves to the two **private** subnet ids, not public ones.
- [ ] `vpc_security_group_ids` contains **exactly** the network component's database group id.
- [ ] **No `password` attribute appears anywhere in the plan.** `manage_master_user_password` is
      `true` and `master_user_secret` is `(known after apply)`.
- [ ] `backup_window` (`18:00-19:00`) and `maintenance_window` (`Sun:19:00-Sun:20:00`) **do not
      overlap**. *RDS rejects an overlap mid-apply.*
- [ ] `rds.force_ssl` shows `apply_method = "immediate"`, not `pending-reboot`. *A static
      parameter would need an explicit reboot step.*
- [ ] `engine_version` is `"16"` — the **major version only**, no minor component.
- [ ] `storage_encrypted` is **true** and `kms_key_id` resolves to the default `aws/rds` key, not
      a customer-managed one.
- [ ] The log group is created **before** the instance. *If the service creates it first, the
      apply fails with `ResourceAlreadyExistsException` rather than adopting it.*

### The check that matters most

- [ ] **The change is an edit, not a replacement.** A plan showing `must be replaced` or
      `-/+ destroy and then create replacement` for `aws_db_instance.main` **destroys the staging
      data**. Identifier, engine, and storage-encryption changes all force replacement. If you see
      it and did not intend it, **stop and do not apply**.

## 6. Apply

1. **Actions → Terraform State Apply → Run workflow** (from `main`).
2. Supply the `plan_run_id` from §4 and the typed `APPLY <alias>` confirmation.
3. Instance creation takes **several minutes**. The step is not hung.

### If the apply fails midway

SCRUM-173's did, and so did this component's first one. The recovery is the same: **do not destroy
and rebuild, and do not hand-edit state.** Terraform recorded what it created, so re-running plan
from `main` converges — expect a smaller "to add" count and zero destroys.

If the log group was created but the instance was not, that is the safe failure direction: the
group is empty, costs nothing, and the next apply adopts it because Terraform already tracks it.

### Status: first apply failed partway (run 30702539990, 2026-08-01)

`logs:DescribeLogGroups` was scoped to an ARN pattern in the apply policy, which the CloudWatch
Logs API rejects — see the warning in §3.2. **Two of six resources were created:**

| Resource | State |
| --- | --- |
| `aws_db_subnet_group.main` | **created**, tracked in state |
| `aws_db_parameter_group.main` | **created**, tracked in state |
| `aws_cloudwatch_log_group.postgresql` | not created — this is where it stopped |
| `aws_db_instance.main` | not attempted |
| `aws_ssm_parameter.db_url` | not attempted |
| `aws_iam_role_policy.pinned_credential_read` | not attempted |

**The failure direction was safe.** No instance exists, so no data is at risk; no credential was
created; nothing is billing beyond two free metadata resources. Terraform recorded both created
resources, so the state is consistent rather than partial-and-unknown.

**Recovery, in order:**

1. Merge the corrected `apply-role-policy.json`.
2. **Re-attach `CrewSafeDatabaseTerraformApply`** from the corrected document — the policy is
   applied by hand, so merging alone changes nothing in AWS.
3. Re-dispatch plan from `main`. Expect **4 to add, 0 to change, 0 to destroy** — the subnet group
   and parameter group are already tracked and must not reappear as additions. If either shows as
   an addition or a replacement, stop: the state does not match what the account holds.
4. Review per §5 and apply.

## 7. Verify after apply

```
terraform show      # no password value anywhere (SC-003)
```

- All six outputs resolve.
- `/crewsafe/shared-dev/db/url` exists, type `String`, value shaped
  `jdbc:postgresql://<host>:5432/crewsafe?sslmode=require` — **no credential in it**.
- The inline policy `crewsafe-shared-dev-db-credential-read` is attached to
  `crewsafe-shared-dev-task-execution`, and its resource is the real `rds!db-...` ARN, not a
  wildcard.
- SCRUM-174's `CrewSafeSecretsTerraformApply` policy is **still present** on the apply role. *If
  it vanished, an inline policy name collided — see §3.*

### Re-run the plan once more

Expect **no changes**. This proves two things at once: the definition is idempotent, and the
service's ownership of the credential produces no drift.

## 8. Restoring after data loss — one procedure, not two

**A restore alone does not restore service.** Restoring produces a **new instance with a new
endpoint and a new service-managed credential**. The published URL entry and the pinned credential
grant would still address the old one — and every resource would look correct in isolation, which
makes this the most misleading failure this component can produce.

1. Restore to a point in time within the retention window (7 days), into a **new** instance
   identifier.
2. Update the component to point at the restored instance.
3. **Dispatch plan and apply.** This re-derives the connection URL and the pinned credential grant
   onto the restored instance automatically — both are derived, never literal, precisely so this
   step works without hand-editing.
4. Restart the application tasks so they pick up the new URL and credential.

**Recovery time** = restore duration + one CI plan-and-apply round trip. Tens of minutes for a
shared development environment, accepted rather than minimised.

## 9. When storage reaches its ceiling

Automatic growth stops at `max_allocated_storage` (100 GiB by default) and **writes begin
failing**. That is deliberate: it is the only refusal point a runaway consumer meets.

**Establish why the data grew before raising the ceiling.** For synthetic demonstration data,
reaching 100 GiB almost certainly indicates a defect — a runaway migration, a seeding loop, an
unbounded weather-observation table — not genuine capacity need. Raising the ceiling without
finding the cause converts a contained failure into an uncontained bill.

There is **no alert before the ceiling is reached**; the first signal is a write failure. Alerting
is a recorded operational follow-up.

## 10. Unannounced credential rotation

The managed service rotates the master password **on its own schedule, with no dispatch by
anyone.** This is a normal event, not an incident.

**What it looks like**: a running task fails to authenticate against a database that is otherwise
healthy. No Terraform plan reports drift, because no component tracks the value.

**The recovery is replacing the task, not editing a secret.** The task execution identity reads
the current value from `master_user_secret_arn` at task start; a new task gets the new password.
A deploy path with no restart path turns this into an outage — which is why it is one of the
obligations SCRUM-176 inherits.

**Never** attempt to write a password into the service-managed secret by hand. The service owns
it.

## 11. Maintenance windows and demonstrations

Automatic minor version upgrades apply inside `Sun:19:00-Sun:20:00` UTC — **03:00–04:00 Monday
Singapore time**. With no standby, the instance may be briefly unavailable during that window and
during storage scaling events.

**The one scheduling obligation this places on the team: do not demonstrate during the maintenance
window.**

A plan run after an automatic upgrade must report **no** engine version change. If it proposes
reverting the version, the major-only pin was lost — fix `engine_version` back to `"16"`, and do
**not** reach for `ignore_changes`, which the source guard forbids because it would hide genuine
drift alongside the intended kind.

## 12. Destroy

**Refused twice.** `allow_destroy: false` in the component catalogue refuses the dispatch, and
`deletion_protection = true` refuses the deletion at the service even if that guard were bypassed.

If a teardown is ever genuinely intended, it requires: a catalogue change (reviewed), disabling
deletion protection (reviewed apply), and then the destroy — with a final snapshot taken
automatically because `skip_final_snapshot` is `false`. Three deliberate steps, by design.

Every backend lane depends on this instance. Losing its data blocks all of them at once.
