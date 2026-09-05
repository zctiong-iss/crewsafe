# Runbook — decommissioning the shared-dev AWS account to zero spend

Tears down every billable CrewSafe resource in a `shared-dev` account through the
reviewed CI workflows, and cleans up by hand the few things those workflows are
not permitted to delete.

This runbook has no Jira key. It was written during a period when the project's
Jira site was no longer reachable, so the usual `SCRUM-<id>-<slug>.md` naming does
not apply. Everything else in `AGENTS.md` still does — in particular, **nothing
here is ever run from a workstation**. There is no local `terraform destroy`, no
local AWS profile, and no downloaded state.

Teardown is irreversible. Read section 1 before dispatching anything.

---

## 1. What is actually billing

Ordered by cost, largest first. The first three are the ones that matter; the
rest round to nothing but are removed anyway so the account settles at a true
zero rather than a few cents that keep the bill alive.

| Component | Billable resource | Rough monthly cost |
|---|---|---|
| `network` | NAT gateway + Elastic IP (`ap-southeast-1`) | ~US$32 plus data processing |
| `compute` | ALB, ECS Fargate tasks, 2 CloudFront distributions, CloudWatch logs | ~US$20+ |
| `database` | RDS `db.t4g.micro`, 20 GiB gp3, 7-day backups | ~US$15 |
| `ecr` | Image storage, **Security Hub**, **Inspector** ECR scanning | low, but per-finding and per-scan |
| `secrets` | Secrets Manager entries | ~US$0.40 per secret |
| `cognito` | User pool | free below the ESSENTIALS tier threshold |
| `developer-access` | IAM users and group | zero |
| `securityhub-import` | IAM role only | zero |
| `state-backend` | S3 state bucket | cents |

Two components are **never** destroyed:

- **`state-backend`** — holds every other component's state, carries
  `prevent_destroy`, and its apply role has no `s3:DeleteBucket`. It is removed
  by hand, last, in section 6.
- **`iam-policy-management`** — owns the very permissions a destroy needs, and
  its policies carry `prevent_destroy`
  ([main.tf:112](../../infra/terraform/iam-policy-management/main.tf#L112)). IAM
  policies cost nothing; leave them.

### 1.1 The permission gaps — read this, it shapes the whole sequence

The apply roles were built for create and update, not for teardown. Two gaps
survive into this runbook and are handled by hand in section 5 rather than by
extending the policies:

1. **No `s3:DeleteObject` anywhere** in
   [policies/](../../infra/terraform/iam-policy-management/policies/). The four
   compute buckets will all be non-empty (ALB logs, CloudFront logs, the SPA
   build, S3 access logs), so `force_destroy = true` cannot empty them and the
   bucket deletions will fail with `AccessDenied`.
2. **No `iam:DeleteRole`** for `crewsafe-shared-dev-backend-deploy`,
   `-ml-service-deploy`, or `-cognito-mapping-publish`. Only the `web-sync` role
   is covered, by the `compute-web` policy.

Both failures land at the **end** of the compute destroy, after the ALB, ECS
services, and CloudFront distributions — everything expensive — are already
gone. That is why section 4.2 expects a partial failure and section 5 finishes
the job. **Do not treat that failure as a reason to stop.**

---

## 2. Preconditions

1. The unlock pull request (section 3) is merged to `main`. The Terraform
   workflows reject any plan or apply dispatched from another ref.
2. The target account alias is registered in `CREWSAFE_AWS_ACCOUNTS_JSON`.
3. You have AWS console access to the account as an administrator, for section 5.
4. Everyone who uses the staging environment knows it is going away. The
   CloudFront hostnames are provider-issued and **not recoverable** — a rebuild
   hands out different ones.
5. You have decided whether the RDS final snapshot is worth keeping. See 4.2.

---

## 3. The unlock pull request

Teardown is refused three times over by design. The unlock PR removes exactly
one of those refusals and leaves the other two standing.

| Refusal | Where | Removed by the unlock PR? |
|---|---|---|
| `allow_destroy: false` in the component catalogue | [components.json](../../.github/terraform/components.json) | yes, for the eight workload components |
| Deletion protection at the AWS service | RDS, ALB, Cognito, ECR | no — lowered per-dispatch by the `decommission` input |
| Typed `DESTROY <alias> <component>` confirmation | [terraform-apply.yml](../../.github/workflows/terraform-apply.yml) | no |

The service-level protections are **not** hardcoded off. They are wired to a
`decommission` variable that defaults to `false`, so a normal plan or apply is
completely unchanged, and a teardown must ask for the lowering explicitly via the
new `decommission` input on Terraform Plan:

- `database` — `deletion_protection = !var.decommission`
- `compute` — `enable_deletion_protection = !var.decommission`, plus
  `force_destroy = var.decommission` on all four buckets
- `cognito` — `deletion_protection = var.decommission ? "INACTIVE" : "ACTIVE"`
- `ecr` — `force_delete = var.decommission` on all three repositories

Each root's existing guard tests still assert the protected default, and a new
paired test asserts the switch actually lowers it. `test-component-catalog.sh`
asserts the destroy-enabled set **exactly**, in both directions, so the revert in
section 7 cannot be half-done without failing CI.

---

## 4. Destroy through CI

Every component is two dispatches: a **plan**, reviewed, then an **apply** of
that exact reviewed plan. Plan artifacts expire after one day and each may be
applied only once.

The workflow files are `terraform-plan.yml` and `terraform-apply.yml`. Their
display names are `Terraform Plan` and `Terraform Apply` — note that some older
runbooks call them "Terraform State Plan"/"Terraform State Apply", which no
longer matches the workflow files. Dispatch by filename to avoid the ambiguity.

### 4.1 The order, and which components need a protection-lowering apply first

Reverse dependency order. Do not reorder — `compute` reads remote state from
almost everything else, and `network`'s NAT gateway cannot go until the things
inside the VPC are gone.

| # | Component | Phase 1: apply with `decommission=true` | Phase 2: destroy |
|---|---|---|---|
| 1 | `compute-shared-dev` | **required** (ALB protection, bucket `force_destroy`) | yes |
| 2 | `database-shared-dev` | **required** (RDS deletion protection) | yes |
| 3 | `securityhub-import-shared-dev` | not needed | yes |
| 4 | `ecr-shared-dev` | **required** (`force_delete` on repos holding images) | yes |
| 5 | `secrets-shared-dev` | not needed | yes |
| 6 | `cognito-shared-dev` | **required** (pool deletion protection) | yes |
| 7 | `developer-access-shared-dev` | not needed | yes |
| 8 | `network-shared-dev` | not needed | yes |

`securityhub-import` must go **before** `ecr`, because `ecr` is what disables
Security Hub for the account and `securityhub-import` references the hub ARN.

### 4.2 The dispatch loop

For each component in the order above.

**Phase 1 — lower the protections (only for the four marked "required").** This
is an ordinary `apply`; it changes attributes in place and destroys nothing.

```bash
gh workflow run terraform-plan.yml --ref main \
  -f target_account_alias=<alias> \
  -f terraform_component=<component> \
  -f operation=apply \
  -f decommission=true
```

Review the plan artifact. It must show **only** protection attributes changing —
`deletion_protection`, `enable_deletion_protection`, `force_destroy`,
`force_delete`. Any resource being created, replaced, or destroyed at this stage
means something else has drifted; stop and investigate. Then:

```bash
gh workflow run terraform-apply.yml --ref main \
  -f target_account_alias=<alias> \
  -f terraform_component=<component> \
  -f operation=apply \
  -f plan_run_id=<id> -f plan_run_attempt=<attempt> \
  -f confirmation="APPLY <alias> <component>"
```

**Phase 2 — destroy.** Keep `decommission=true`; the destroy plan is generated
against the same configuration.

```bash
gh workflow run terraform-plan.yml --ref main \
  -f target_account_alias=<alias> \
  -f terraform_component=<component> \
  -f operation=destroy \
  -f decommission=true
```

Review the destroy plan and confirm the resource count matches what that
component owns and that it touches nothing outside it. Then:

```bash
gh workflow run terraform-apply.yml --ref main \
  -f target_account_alias=<alias> \
  -f terraform_component=<component> \
  -f operation=destroy \
  -f plan_run_id=<id> -f plan_run_attempt=<attempt> \
  -f confirmation="DESTROY <alias> <component>"
```

**Expected failures, which are not reasons to stop:**

- **`compute`** will fail near the end on the four S3 buckets and on three IAM
  roles, per section 1.1. The ALB, ECS cluster and services, and both CloudFront
  distributions will already be gone — which is the entire cost. Section 5.1 and
  5.2 finish it, then re-run the Phase 2 destroy to clear the state.
- **`database`** takes a final snapshot named `crewsafe-shared-dev-final` on the
  way out. This is deliberate — `skip_final_snapshot` stays `false` even during
  a decommission, so the data stays recoverable until you delete the snapshot
  yourself in 5.3. The snapshot bills at roughly US$2/month for 20 GiB, so it
  must be deleted to reach a true zero.
- **`ecr`** disables Security Hub and Inspector account-wide as it goes.

---

## 5. Console mop-up

Everything here is what the CI roles are not permitted to do. Perform it as an
account administrator in the AWS console.

### 5.1 Empty and delete the four compute buckets

Do this **after** the compute destroy has removed the ALB and CloudFront, not
before — ALB access logs flush every five minutes, so a bucket emptied while the
ALB still exists refills before you can delete it.

```
crewsafe-shared-dev-web
crewsafe-shared-dev-alb-logs
crewsafe-shared-dev-web-logs
crewsafe-shared-dev-cloudfront-logs
```

These have versioning enabled, so use **Empty** (which removes versions and
delete markers) and then **Delete**.

### 5.2 Delete the three uncovered IAM roles

```
crewsafe-shared-dev-backend-deploy
crewsafe-shared-dev-ml-service-deploy
crewsafe-shared-dev-cognito-mapping-publish
```

Then re-run the Phase 2 `compute` destroy from 4.2 so Terraform's state agrees
with reality and the component settles empty.

### 5.3 Delete the RDS final snapshot

**RDS → Snapshots → Manual**, delete `crewsafe-shared-dev-final`. Only do this
once you are certain nothing in it is needed — this is the point of no return
for the staging data.

### 5.4 Sweep for stragglers

- **Elastic IPs** — an unattached EIP bills. Confirm none remain in
  `ap-southeast-1`.
- **CloudWatch log groups** — services recreate these outside Terraform. Delete
  any remaining `/aws/ecs/crewsafe-*`, `/aws/rds/*`.
- **Security Hub and Inspector** — confirm both show disabled. Check **every
  region**, not just `ap-southeast-1`; these are frequently enabled account-wide
  and each enabled region bills separately. This is the single most common cause
  of a "decommissioned" account that still bills.
- **ECR** — confirm no repositories remain.
- **Cognito** — confirm the user pool and its domain are gone.

### 5.5 Remove the state bucket, last

Only once every other component's state is empty and you no longer need the
history. Empty the bucket (it is versioned) and delete it. Its key layout is in
[bootstrap/state/README.md](../../infra/terraform/bootstrap/state/README.md).

Leaving it costs a cent or two a month; deleting it makes the account
unambiguously zero but discards the audit trail of every apply.

### 5.6 Deregister the account

Remove the alias from the `CREWSAFE_AWS_ACCOUNTS_JSON` repository variable so no
workflow can target the account again. Optionally delete the two GitHub OIDC
roles and the identity provider.

---

## 6. Verify zero

1. **Billing → Bills**, current month, expand **by service**. Anything still
   listed with a non-trivial figure points at something section 5.4 missed.
2. Set a **zero-dollar budget alert** as a tripwire — it costs nothing and
   catches a resource in a region you did not check.
3. Re-check after the next full billing cycle closes. Some charges land in
   arrears, so a clean bill on the day of teardown is not yet proof.
4. **Cost Explorer**, grouped by region, is the fastest way to find spend
   outside `ap-southeast-1`.

---

## 7. Close the decommissioning window

Once the account is empty, revert the unlock PR. This restores:

- `allow_destroy: false` across the catalogue
- the `deletion_protection` / `force_destroy` / `force_delete` literals
- the per-component guard assertions in `test-component-catalog.sh`,
  `test-ecr-web-source-guard.sh`, and `test-securityhub-import-source-guard.sh`
- the `decommission` input on `terraform-plan.yml` and the variable in the four
  roots

`main` is then back to refusing a destroy dispatch, and the Terraform roots stay
usable if the project is ever rebuilt into a fresh account.
