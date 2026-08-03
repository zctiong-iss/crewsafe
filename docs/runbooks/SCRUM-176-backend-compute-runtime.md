# Runbook — `compute-shared-dev` (SCRUM-176)

Backend compute runtime and staging DNS. The seventh Terraform component, and the one that makes
the deployed backend reachable.

**Component**: `compute-shared-dev` · **Root**: `infra/terraform/compute` · **State key**:
`crewsafe/compute/shared-dev.tfstate` · **Destroy-approved**: no

**Plan**: [SCRUM-176-backend-compute-runtime-plan.md](../plans/SCRUM-176-backend-compute-runtime-plan.md)

---

## 1. What this component is

ECS Fargate running the `com.crewsafe` Spring Boot backend in the private subnets
`network-shared-dev` published, behind an **internal** load balancer that only a CloudFront VPC
origin can reach. The public entry point is the distribution's provider-issued
`*.cloudfront.net` name with a publicly trusted certificate.

```text
client ──443/TLS──> CloudFront distribution
                         │  VPC origin, AWS private path
                         ▼
                    INTERNAL load balancer (private subnets, no public address)
                         │  8080, by security group reference
                         ▼
                    Fargate task (private subnets, no public IP)
                         │  5432, by security group reference
                         ▼
                    RDS PostgreSQL (SCRUM-175)
```

Fourteen resources. Everything the application needs is resolved **by reference** at task start
using the two roles `secrets-shared-dev` published — nothing is baked into the image, and no
credential is in Terraform source, state, a plan artifact, or a log.

---

## 2. Read this before your first dispatch

### Terraform 1.10.5, and generate the lock file with explicit platforms

CI pins **1.10.5**. A newer local Terraform passes locally and fails in CI. Worse, a lock file
produced by a bare `terraform init` on an Apple Silicon workstation records `darwin_arm64` hashes
only, and CI runs `linux_amd64` — that failure is currently red on pull request #40:

```text
Error: registry.terraform.io/hashicorp/aws: the cached package for
hashicorp/aws 6.57.1 does not match any of the checksums recorded in the lock file
```

```bash
terraform version    # must be 1.10.5

# Only when the provider version changes. Three platforms, matching every other component.
terraform -chdir=infra/terraform/compute providers lock \
  -platform=linux_amd64 -platform=darwin_arm64 -platform=darwin_amd64
```

### Terraform state is NOT the source of truth for the running image

This inverts what every other component in this repository holds, so it is stated first rather
than discovered.

The service declares `ignore_changes = [task_definition, desired_count]`. Terraform creates the
cluster, an initial task definition, and the service, and then stops owning the deployed image —
SCRUM-145 registers each new revision and forces a new deployment. The divergence is deliberate,
annotated in `main.tf`, and asserted.

```bash
# CORRECT — ask the service
aws ecs describe-services --cluster crewsafe-shared-dev --services backend \
  --query 'services[0].taskDefinition'

# WRONG — the state file holds the INITIAL revision, by design
terraform show | grep task_definition
```

Why: the shared plan and apply workflows pass exactly four `TF_VAR_*` values and offer no
per-component input, so the image tag cannot be a dispatch value without changing shared CI that
every component inherits. Separating the concerns was the smaller change, and an infrastructure
apply — reviewed plan, typed confirmation — is the wrong gate for shipping a build.

---

## 3. Attach the IAM policies

Hand-applied documents, not Terraform-managed resources — the same manual step the SCRUM-154,
SCRUM-155, SCRUM-173, SCRUM-174, and SCRUM-175 runbooks describe. **Merging this component changes
nothing in AWS until these are attached**; a plan dispatched before them fails with `AccessDenied`.

| Role | Policy name | Attach as | Document |
| --- | --- | --- | --- |
| `CrewSafeGitHubTerraformPlanRole` | `CrewSafeComputeTerraformPlan` | **inline** | [`iam/plan-role-policy.json`](../../infra/terraform/compute/iam/plan-role-policy.json) |
| `CrewSafeGitHubTerraformApplyRole` | `CrewSafeComputeTerraformApply` | **customer-managed** | [`iam/apply-role-policy.json`](../../infra/terraform/compute/iam/apply-role-policy.json) |

**The two are attached differently, and that is not an oversight — see the budget note below.** The
apply document was the one that exhausted the role's inline-policy budget, so it is attached as a
customer-managed policy instead. The document is unchanged either way; only the attachment
mechanism differs.

> **The policy name is load-bearing. Get it exactly right.** Attaching an inline policy is an
> **upsert**: saving one whose name already exists silently *replaces* it, with no warning and no
> error. Both roles are shared across every component and already carry
> `CrewSafeCognitoTerraformPlan`/`Apply` (SCRUM-154), `CrewSafeGitHubTerraformPlan`/`Apply`
> (SCRUM-155), `CrewSafeNetworkTerraformPlan`/`Apply` (SCRUM-173),
> `CrewSafeSecretsTerraformPlan`/`Apply` (SCRUM-174), and `CrewSafeDatabaseTerraformPlan`/`Apply`
> (SCRUM-175). Reusing one of those names deletes that component's permissions, and the damage
> surfaces later as an unrelated-looking `AccessDenied` on *its* next plan — not on anything you
> did.
>
> Nothing in CI validates these names; only the **role** names are enforced. The convention
> `CrewSafe<Component>Terraform<Plan|Apply>` is the only thing keeping them distinct. If #40 lands
> first it adds `CrewSafeEcrTerraformPlan`/`Apply` to the same two roles.

**Replace `<ACCOUNT_ID>` in the apply policy with the target account's twelve-digit id before
attaching. It appears eight times**, across `ManageApplicationLogGroup` (twice),
`ManageCrossOriginParameter`, `PassOnlyTheTwoRolesTheSecretsComponentPublished` (twice), and the
three service-linked-role statements. The plan policy contains no account id.

> **Inline policy budget — this component is the one that broke it.** A role's inline policies share
> a **10,240 non-whitespace character** limit, counted across *all* of them. Attaching this
> component's apply document inline was rejected with *"Your policy exceeds the non-whitespace
> character limit of 10240."*
>
> Measured across the six components: compute **4,624**, database 2,226, network 1,540, cognito
> 1,288, secrets 1,197, bootstrap/state 1,038 — **11,913 total**, over by 1,673. Compute is 39% of it
> alone, because it manages four services the project had not used before. The plan role is
> unaffected at 4,833.
>
> **Resolution: the apply document is attached as a customer-managed policy, not inline.** Managed
> policies do not count toward the inline budget; each gets its own 6,144-char limit and a role can
> carry ten. That puts inline back to **7,289 / 10,240** and compute at **4,624 / 6,144**.
>
> Trimming compute was rejected. Reaching 10,240 needs a third of the document cut, and the only
> compressible part is the enumerated read-only verbs — collapsing them to `ec2:Describe*` and
> friends widens read access across every resource in the account to buy back characters. It also
> only defers the problem: the next component re-breaks a budget sitting at 7,289.
>
> **The remaining 7,289 is still finite.** When the next component cannot fit, convert an existing
> apply policy to customer-managed rather than trimming — the mechanical change below, applied to
> whichever document is largest.

> **Managed attachment does not have the silent-upsert failure mode.** The warning above about
> name collisions destroying another component's permissions applies to **inline** policies only.
> Creating a customer-managed policy whose name already exists **fails with an error** instead of
> replacing it. Managed and inline names live in separate namespaces, so this component's
> `…TerraformPlan` (inline) and `…TerraformApply` (managed) coexist without conflict — but they are
> **removed** differently: detach-then-delete for the managed one, delete for the inline one.

### 3.1 Update the plan role

1. In the AWS Console, open **IAM → Roles**.
2. Select `CrewSafeGitHubTerraformPlanRole`.
3. Open **Permissions → Add permissions → Create inline policy**, then the **JSON** editor.
4. Copy the complete reviewed document from `infra/terraform/compute/iam/plan-role-policy.json`.
5. Confirm it contains six read-only statements — `ReadContainerRuntimePlan`,
   `ReadLoadBalancerPlan`, `ReadDistributionPlan`, `ReadNetworkPlan`,
   `ReadApplicationLogGroupPlan`, `ReadCrossOriginParameterPlan` — and **no** mutating action, **no**
   `secretsmanager:GetSecretValue`, and **no** `iam:PassRole`.
6. Name the policy `CrewSafeComputeTerraformPlan` and save.

### 3.2 Update the apply role

This one is **customer-managed**, so it is created first and attached second. Do not use **Create
inline policy** here — it will be rejected on the character limit.

1. Open **IAM → Policies → Create policy**, then the **JSON** editor.
2. Paste the complete reviewed document from `infra/terraform/compute/iam/apply-role-policy.json`,
   with `<ACCOUNT_ID>` already substituted.
3. Confirm `PassOnlyTheTwoRolesTheSecretsComponentPublished` names the **two exact role ARNs** the
   secrets component published — not a wildcard — **and carries the `iam:PassedToService` condition
   naming `ecs-tasks.amazonaws.com`**. Without the condition, the apply role can hand those roles to
   any service that accepts a passed role.
4. Confirm `ManageApplicationLogGroup` — the **mutating** log actions — is scoped to the two
   log-group ARN forms, not `*`.
5. Confirm `ListLogGroupsApply` holds **exactly one action**, `logs:DescribeLogGroups`, on `*`.
   **Do not "tighten" this to an ARN** — see the first warning below.
6. Confirm `ManageCrossOriginParameter` is scoped to the single parameter ARN, not the prefix and
   not `*`. This component creates exactly one configuration entry.
7. Confirm all **three** service-linked-role statements are present, each scoped to its exact
   `aws-service-role/…` ARN **and carrying its `iam:AWSServiceName` condition** — see the second
   warning below.
8. Confirm it grants **no** `secretsmanager:GetSecretValue`, **no** `logs:GetLogEvents`, and **no**
   `ecs:ExecuteCommand`.
9. Name the policy `CrewSafeComputeTerraformApply` and create it.
10. Go to **IAM → Roles → `CrewSafeGitHubTerraformApplyRole` → Add permissions → Attach policies**,
    filter by **Customer managed**, select `CrewSafeComputeTerraformApply`, and attach.
11. Confirm on the role's **Permissions** tab that it now appears under attached policies. Creating
    the policy without attaching it leaves the role unchanged, and the first plan still fails with
    `AccessDenied` — with nothing on the policy itself to indicate why.

> **`logs:DescribeLogGroups` accepts no resource scope, and scoping it fails the apply.** Inherited
> verbatim from SCRUM-175, which lost apply run 30702539990 to exactly this. The CloudWatch Logs API
> evaluates the action against `log-group::log-stream:` rather than the named group, so a
> correctly-scoped-looking ARN denies the request. It is split into its own statement here for the
> same reason it is in the database policy: so nobody folds it back in while "tidying up".

> **`ManageApplicationLogGroup` lists the log-group ARN twice, with and without the `:*` suffix, on
> purpose.** CloudWatch Logs is inconsistent about which form each action expects, and picking one
> is a coin flip that costs a failed apply to resolve. Both forms address the same single log group,
> so listing both is precise rather than permissive.

> **Three new AWS services in one component, and each may need its service-linked role created on
> the first apply.** SCRUM-175's runbook records the pattern: *"a hand-written least-privilege policy
> for a service the project has not used before will be wrong… budget two or three [failed applies]
> for any new AWS service."* ECS, Elastic Load Balancing, and CloudFront are all new here, so all
> three grants are included pre-emptively rather than discovered one failed apply at a time. Each is
> pinned to one exact role ARN with an `iam:AWSServiceName` condition, so the grant cannot create any
> other service-linked role. If a role already exists in the account the grant is simply unused — it
> is not a permission to delete or modify an existing one.

> **Neither policy grants `secretsmanager:GetSecretValue`, and neither ever should.** The CI roles
> build the task definition that *references* the credentials; the **task execution role** resolves
> them at task start. Inherited from SCRUM-174 and SCRUM-175.

> **Expect this to take more than one attempt, and re-plan rather than widen.** When an apply fails
> on a missing action, add that exact action to the correct statement and re-dispatch. Do not
> broaden a `Resource` to `*` to get past it — that is how a least-privilege policy quietly becomes
> an administrative one.

### 3.3 Actions discovered by a failed apply

The prediction above came true on the first apply. Keep this log — the next component managing a new
AWS service will hit the same class of thing, and the pattern is more useful than the individual
actions.

**Round 1 — run [30795727320](https://github.com/zctiong-iss/crewsafe/actions/runs/30795727320),
`aws_lb.main`:**

```text
AccessDenied: not authorized to perform: ec2:DescribeAccountAttributes
```

`CreateLoadBalancer` calls it internally to read the account's Elastic Load Balancing limits before
allocating. It is an account-wide read with no resource-level form, so `Resource: "*"` is not a
widening here — there is no narrower way to express it.

Added to `ManageLoadBalancerSecurityGroupAndTheOneDelegatedRule`:

| Action | Basis |
| --- | --- |
| `ec2:DescribeAccountAttributes` | **Proven** — the exact action the apply was denied |
| `ec2:DescribeAvailabilityZones` | Pre-emptive — AWS documents it as a `CreateLoadBalancer` prerequisite |
| `ec2:DescribeInternetGateways` | Pre-emptive — same, and called even for an internal load balancer |

The two pre-emptive additions follow the same reasoning already applied to the three
service-linked-role grants: read-only, attributable to the one API call that failed, and cheaper to
include now than to discover one failed apply at a time. Both are `Describe` verbs — neither grants
any mutation.

**Round 2 — run [30796767337](https://github.com/zctiong-iss/crewsafe/actions/runs/30796767337),
`aws_cloudfront_vpc_origin.backend`:**

```text
operation error CloudFront: CreateVpcOrigin, StatusCode: 403
AccessDenied: Access Denied.
```

**No action is named, unlike round 1** — CloudFront returns a bare denial, so the log alone cannot
tell you what to add. The cause was `CreateCloudFrontVpcOriginServiceLinkedRole` naming the wrong
service principal in both places:

| | Was (wrong) | Is |
| --- | --- | --- |
| `Resource` path | `aws-service-role/cloudfront.amazonaws.com/…` | `aws-service-role/vpcorigin.cloudfront.amazonaws.com/…` |
| `iam:AWSServiceName` | `cloudfront.amazonaws.com` | `vpcorigin.cloudfront.amazonaws.com` |

`AWSServiceRoleForCloudFrontVPCOrigin` is trusted by **`vpcorigin.cloudfront.amazonaws.com`**, a
distinct principal from CloudFront's own — see
[Use service-linked roles for CloudFront](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-service-linked-roles.html).
Both the ARN and the condition failed to match, `iam:CreateServiceLinkedRole` was denied, and
CloudFront surfaced that as a generic 403 on its own API. `ap-southeast-1` is on the supported-Region
list, so the Region was not the cause.

> **When a denial names no action, read the service's service-linked-role documentation before
> widening anything.** This looked like a missing `cloudfront:*` action and was not — every CloudFront
> action needed was already granted. Guessing would have added permissions that were never the
> problem and left the real one in place.

> **The apply was partial, and that is normal.** Nine of fourteen resources were created before the
> denial: the log group, the configuration entry, the task definition, the target group, the load
> balancer security group, all three security group rules, and the cluster. They are in state and the
> next apply continues from there rather than starting over. Do **not** try to clean up first.
>
> **You cannot re-apply the same plan.** The `Reject reused reviewed plan` step in the apply workflow
> refuses a consumed `plan_run_id`, and the policy change invalidates the plan regardless. Attach the
> updated policy, then dispatch a **fresh plan**, re-run the §6 checks against it — the remaining
> five resources this time, not twenty-two — and apply that.

#### Updating the managed policy after the first attachment

`CrewSafeComputeTerraformApply` already exists and is attached, so each round is an **edit**, not a
create. Do not create a second policy.

1. **IAM → Policies**, filter **Customer managed**, open `CrewSafeComputeTerraformApply`.
2. **Edit** → the **JSON** tab → paste the updated document with `<ACCOUNT_ID>` substituted.
3. **Next** → **Save changes**. Leave *"Set this new version as the default"* checked, or the role
   keeps using the old version and the next apply fails identically.
4. No re-attachment is needed — the role references the policy, so a new default version takes effect
   immediately.

A managed policy keeps up to **five** versions. Rounds three and beyond may need an old version
deleted first, which is also the audit trail of what was added and when — worth reading before
deleting anything.

---

## 4. Ordering — what must happen before the first apply

Only the **apply** waited on SCRUM-177. **All four steps are now done**; this section is kept as the
record of what had to be true, not as work outstanding.

| | Step | Status |
| --- | --- | --- |
| 1 | **#40 merges** → apply `ecr-shared-dev` → set the `CREWSAFE_ECR_REPOSITORY_URL` and `CREWSAFE_ECR_PUSH_ROLE_ARN` repository variables, so #41's `publish-image` job stops skipping | ✅ merged and applied |
| 2 | **#41 merges** → first image published to `crewsafe/backend` | ✅ pushed 2026-08-03 |
| 3 | Pin `var.initial_image_tag`'s default to that image's commit SHA | ✅ see below |
| 4 | Plan, review, apply (§5–§7) | ⬜ ready to dispatch |

Step 3's second half — *"rebase this branch onto `main`, resolving `components.json` and
`test-component-catalog.sh` against #40's entry"* — **no longer applies.** Both catalogues landed on
`main` together, `ecr-shared-dev` is registered, and the catalogue test already asserts its state key
and `allow_destroy == false`. There was no conflict to resolve.

### The pinned image tag

```text
af7727812ee82bb74afc172fa6e5d4b865752152
```

Merge commit for #52 (the change that added `workflow_dispatch` to backend CI, which is what allowed
the manual publish). Pushed by Backend CI run
[30793342633](https://github.com/zctiong-iss/crewsafe/actions/runs/30793342633), digest
`sha256:cadab448069f94a1480e50645d97bf47678537f1820556141b0aec2231796905`.

> **Nothing offline catches a wrong value here.** The validation accepts any 7–40 lowercase hex
> characters, so the previous placeholder — forty zeros — passed `validate`, `test`, the source
> guard, **and plan-review check 8**, which asks only that the reference is hex and not `latest`. The
> apply then succeeds in full and the *task* fails to pull, surfacing as the image-pull row in §9 one
> complete apply later. Confirm the tag against the registry by eye before dispatching; no automated
> check will do it for you.
>
> The tag does not need refreshing as the backend moves on — it is read once, at initial task
> definition creation, after which `ignore_changes` hands the deployed image to SCRUM-145. It does
> need to still **exist**: SCRUM-177 retains the newest twenty images, so re-pin if twenty pushes
> land before the first apply.

---

## 5. Offline checks — before every push

```bash
cd infra/terraform/compute
terraform fmt -check -recursive .
terraform init -backend=false
terraform validate
terraform test                       # 15 runs, mocked provider, no AWS account

cd -
.github/scripts/terraform/tests/test-compute-source-guard.sh
.github/scripts/terraform/tests/test-component-catalog.sh
.github/scripts/terraform/tests/test-ci-guards.sh
.github/scripts/terraform/tests/test-workflow-guards.sh
```

---

## 6. Dispatch a plan, then review it by eye

```bash
gh workflow run "Terraform State Plan" \
  -f target_account_alias=<alias> \
  -f terraform_component=compute-shared-dev \
  -f operation=apply
```

### Mandatory plan-review checks

**A clean plan does not prove every server-side constraint is met.** That is SCRUM-173's most
expensive lesson — its first apply died 16 resources in on a constraint no plan showed. Confirm
each of these by reading the plan output:

| # | Check | Why it is not caught earlier |
| --- | --- | --- |
| 1 | `aws_lb.main` shows `internal = true`, subnets are the **private** ids | The single most consequential argument here |
| 2 | Service `assign_public_ip = false`, `security_groups` has **exactly one** entry | Membership of that group is the only thing granting database access |
| 3 | Task definition `environment` has **no** credential and **no** Flyway/DDL variable | |
| 4 | Every `valueFrom` ends with the ARN, a JSON key, and **two colons** | A pinned version turns credential rotation into an outage |
| 5 | `NEA_API_KEY` does **not** appear | The secret has no version; referencing it fails the task start |
| 6 | `readonlyRootFilesystem = true` **and** a `tmpfs` mount at `/tmp` | **Both, or the task will not start** — the JVM writes `hsperfdata` and Tomcat allocates scratch there, and the failure happens before the first log line |
| 7 | Log group name begins `/crewsafe/shared-dev/` | Outside that scope the execution role's grant does not cover it |
| 8 | Image reference is `<repo>:<40-hex>`, not `latest` | |
| 9 | Exactly **one** new ingress rule targets the application security group | |
| 10 | Security group descriptions contain **no apostrophe** | EC2 rejects it at create time, not at plan — **this is what broke SCRUM-173's first apply** |
| 11 | Distribution minimum protocol is `TLSv1.2_2021`, cache policy is `CachingDisabled` | Without the explicit minimum the default certificate implies TLS 1.0 |
| 12 | Resource count is at or under 22 | |

---

## 7. Apply

```bash
gh workflow run "Terraform State Apply" \
  -f target_account_alias=<alias> \
  -f terraform_component=compute-shared-dev \
  -f plan_run_id=<the reviewed run id> \
  -f confirmation="APPLY <alias>"
```

### Verify after applying

```bash
BASE=$(<staging_base_url from the apply output>)

curl -fsS "$BASE/actuator/health"                                    # {"status":"UP"}
curl -sS -o /dev/null -w '%{http_code}\n' "http://${BASE#https://}/actuator/health"  # 301
curl -sS --tlsv1.1 --tls-max 1.1 "$BASE/actuator/health"             # must FAIL
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE/api/v1/me"          # 401, from the application
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/me"         # 200 — header reached the app
```

### Measure the cold start and correct the grace period

`health_check_grace_period_seconds` defaults to **180, which is an estimate**. Measure it:

```bash
aws logs tail /crewsafe/shared-dev/backend --since 15m \
  | grep -E 'Flyway|Started CrewSafeApplication'
```

Take the elapsed time from the first Flyway line to `Started CrewSafeApplication`, add the JVM cold
start, set the variable's default to roughly twice the total, and record the measurement here.

> **Measured cold start:** *to be filled in on the first apply*

---

## 8. Deploying and recovering — one procedure, three cases

None of these needs a Terraform apply.

```bash
CLUSTER=crewsafe-shared-dev
SERVICE=backend

# (a) Deploy a new image — SCRUM-145 automates this
aws ecs register-task-definition --cli-input-json file://<revision naming the new commit SHA>
aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" \
  --task-definition <new revision> --force-new-deployment

# (b) Pick up a rotated database credential
# (c) Pick up a restored database's new address
aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --force-new-deployment
```

The deployment circuit breaker rolls back automatically if the new tasks never become healthy, so
the previous task set keeps serving throughout.

**Always name a commit-SHA tag, never `latest`.** A mutable tag makes a rollback ambiguous, and
re-pushing the same tag does not by itself cause a task to be replaced.

### Rollback depth is bounded

SCRUM-177's lifecycle policy keeps the newest **twenty** images with `tagStatus: any`. A rollback
target older than that has been expired and must be rebuilt from its commit. Twenty merges of
headroom is comfortable in practice; it is not unbounded, and raising the cap is SCRUM-177's
decision.

---

## 9. Diagnosing a task that will not start

Everything lands in `/crewsafe/shared-dev/backend`. There is no other diagnosis path.

| Symptom | Likely cause |
| --- | --- |
| Exit before any application log line | Read-only root filesystem with no writable `/tmp` (check 6 above) |
| `ResourceNotFoundException` on a secret | A reference to a versionless secret — most likely `NEA_API_KEY` was added before its value was written |
| Image pull failure | The pinned tag was never pushed, or it aged out of the twenty-image retention window |
| Authorization error resolving a parameter or secret | A name outside `/crewsafe/shared-dev/*` or `crewsafe/*` — reads as a permissions bug, is actually a naming one |
| Connection timeout to the database | The task is not in the application security group. Membership is the only thing granting access |
| Killed and retried forever during startup | The grace period is shorter than migrations plus context startup |
| Healthy but every write endpoint fails at the edge | The distribution's `allowed_methods` is missing the state-changing methods |

---

## 10. Known interim posture — FR-032 is discharged by a follow-up, not here

SCRUM-174 deferred pinning the execution and task roles to a specific cluster until a cluster
existed. It now exists — but the pinning **cannot be applied from this component**: a role's
`assume_role_policy` is an attribute of a resource `secrets-shared-dev` owns, not a separately
attachable one. (SCRUM-175 could add a pinned credential grant from outside only because
`aws_iam_role_policy` *is* separate.)

Resolution, decided at the plan review: this component publishes **`cluster_arn`** as an output, and
**[SCRUM-191](https://u-team-h6ii4x03.atlassian.net/browse/SCRUM-191)** applies the condition to
`secrets-shared-dev` referencing it. Raised 2026-08-02, blocked by SCRUM-176, related to SCRUM-174.

> **Until SCRUM-191 lands**: the two roles are assumable by the ECS tasks service principal
> **account-wide**, not only by tasks in this cluster. The exposure is bounded today — the account
> holds exactly one cluster and Terraform is CI-only — and it grows the moment a second cluster
> exists.

Do not delete the `cluster_arn` output because it looks unused. Its only consumer is SCRUM-191.

When SCRUM-191 lands, delete this section.

### Two accepted Trivy exemptions

The `security` job scans `infra/terraform` at HIGH,CRITICAL and fails the build. Two findings on
this component are suppressed inline with `#trivy:ignore:` and the reasoning beside them in
`infra/terraform/compute/main.tf` — the same convention `network` and `bootstrap/state` already use.
Neither is a scanner false positive; both are decisions.

| Finding | Where | Why it is accepted |
| --- | --- | --- |
| `AWS-0054` — listener does not use HTTPS | `aws_lb_listener.backend` | The rule reads `protocol` without reading `internal`. What it asks for is unobtainable: no publicly trusted certificate can be issued for the `*.elb.amazonaws.com` name this listener answers on. That constraint is the reason the load balancer is internal and the reason the edge is a CloudFront VPC origin. **If the load balancer ever becomes public this exemption is wrong** — the source guard forbids `internal = false` to keep the two from drifting apart. |
| `AWS-0011` — distribution has no WAF | `aws_cloudfront_distribution.main` | Production edge control, per-account monthly cost, rule set needs tuning against real traffic. This is a single-task dev environment whose only client is the team; an untuned managed rule group buys a green scan and false blocks. Revisit when a production environment is specified. |

The third finding the scan first raised, `AWS-0052` (invalid header fields), was **fixed rather than
suppressed** — `drop_invalid_header_fields = true`, asserted in the `boundary` run block. The
distribution forwards viewer headers verbatim under `Managed-AllViewerExceptHostHeader`, so this is
the last hop that can reject a malformed one before the task sees it.

Adding a resource that trips a new HIGH or CRITICAL means either fixing it or adding a third row
here with the same standard of reasoning. `trivy config --severity CRITICAL,HIGH --exit-code 1
infra/terraform/` reproduces the CI job locally and needs no AWS credentials.

---

## 11. Obligations this component cannot enforce

| On | Obligation |
| --- | --- |
| SCRUM-177 | Keep publishing a commit-SHA tag; keep the repository under `crewsafe/*`; the image keeps running as a non-root user on 8080 with no configuration baked in |
| SCRUM-145 | Deploy with `force-new-deployment` naming a commit-SHA tag, **never** a Terraform apply; do not introduce a migration step; do not "fix" the `ignore_changes` divergence |
| Web/mobile client issues | Update the cross-origin entry's value to the real browser origin; point clients at the published `staging_base_url`, never a hard-coded address |
| SCRUM-144 | Do not re-path `/actuator/health` or change its success semantics without updating the target group probe. Extending what it reports is safe |
| An operator | Write the weather API key's value out of band before live ingestion is expected to work. This component makes an unset key survivable, not populated |
| Anyone | Do not add a second inbound rule to the application security group. The single rule created here is the whole inbound boundary for the runtime tier |
