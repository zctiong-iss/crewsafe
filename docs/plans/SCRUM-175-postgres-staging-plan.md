# SCRUM-175 — Managed PostgreSQL Staging Instance and Connection Wiring

**Jira**: [SCRUM-175](https://u-team-h6ii4x03.atlassian.net/browse/SCRUM-175) (subtask of
SCRUM-142) · **Component**: `database-shared-dev` · **Runbook**:
[SCRUM-175-postgres-staging.md](../runbooks/SCRUM-175-postgres-staging.md)

## Summary

The fifth Terraform component. It provisions one RDS for PostgreSQL 16 instance for the shared
development deployment, in the private subnets `network-shared-dev` published, attached to the
database security group that component already created — and it publishes the connection URL the
backend reads at runtime.

**Six resources.** The interesting property is not a resource but an **absence**: there is no
`password` argument anywhere, and there never may be. Everything else in the design exists to
make that absence provable and to keep it that way.

## The central decision: the service owns the credential

The managed database service generates the master password, stores it in a secret it names under
the reserved `rds!` prefix, and rotates it natively. Terraform receives back only
`master_user_secret` — an identifier, no value.

SCRUM-174 anticipated this exactly, and named a literal password here as **"the likeliest way
this design is undone, because setting a password explicitly is the more obvious thing to
write."** That is why the guarantee is structural rather than conventional. These constructs are
forbidden and a shell source guard enforces it:

| Forbidden | Why |
| --- | --- |
| a literal `password =` argument | Puts a live credential into plaintext state |
| `random_password` / `random_string` / `random_id` | Generates a value into state |
| any variable whose name could carry a password | A committed tfvars file could then supply one |
| `aws_secretsmanager_secret` / `_version` | The service creates and names the credential |
| `data "aws_secretsmanager_secret_version"` | Reading is as damaging as writing |
| `with_decryption = true` | Pulls a SecureString value into state |
| `type = "SecureString"` | Same, and the connection URL is not a credential |
| `aws_kms_key` | A second authorization surface the IAM tests do not inspect |
| `aws_security_group` and any rule | A second inbound control surface SCRUM-173's test does not inspect |
| `log_statement` / `log_min_duration_statement` | Would place worker data in an operational log |
| `provisioner`, `null_resource`, `local-exec` | Would execute SQL; the migration set owns the schema |
| `aws_ecs_*`, `aws_codebuild_project`, `aws_ecr_repository` | Migration infrastructure SCRUM-176 owns |
| `ignore_changes` on `engine_version`/`password`/`value` | Hides genuine drift alongside intended drift |

Marking outputs `sensitive` would **not** achieve this: it suppresses console rendering while the
value sits in plaintext in the state object in S3, readable by anyone with `s3:GetObject` on the
bucket. A leaked state file is not a leak that can be retracted.

### A second, independent guarantee

Neither the plan role nor the apply role is granted `secretsmanager:GetSecretValue`. The CI roles
provision the instance and can never read the credential the service manages, so `terraform plan`
cannot produce a diff containing it **even if every other control here were wrong**. This does not
depend on the source guard being correct.

## Scope decisions, and what each costs

### 1. Placement is consumed, never re-declared

The private subnet ids and the database security group id come from `network-shared-dev` through
remote state. **This component declares no security group and no security group rule.**

SCRUM-173 already created the database group with exactly one ingress rule — 5432/TCP from the
application group — and no egress rule at all. A second group here would be a second inbound
control surface, and that component's negative test, the one demonstrated catching a widened
rule, inspects only its own.

**Cost**: a rename or retype of `private_subnet_ids` or `database_security_group_id` breaks this
component at plan time. That is intended — they are documented as breaking to change.

### 2. The two controls the network could not provide

SCRUM-173 recorded both as obligations it could not enforce, and both are load-bearing on their
own because routing provides no second barrier — the database shares the private tier with the
application:

- **`publicly_accessible = false`.** A publicly accessible instance in a private subnet still
  receives a public endpoint, and no security group rule prevents reaching it.
- **Port 5432.** The single ingress rule admits that port and nothing else. A different port
  leaves the instance running and unreachable, with no error raised by either component.

Each has a dedicated assertion **and** a source-guard rule, rather than being treated as a
default.

### 3. Transport encryption is required, not offered

A custom parameter group sets `rds.force_ssl = 1`, so the **server refuses** an unencrypted
connection. A client-side `sslmode` alone is a request the server may ignore. The default
parameter group cannot be modified, so the custom group is mandatory rather than a preference.

**Cost**: the published URL uses `sslmode=require`, which encrypts but does not verify the server
certificate. `verify-full` would need the RDS CA bundle inside the container image — a build-time
dependency on a rotating certificate, owned by SCRUM-176 — for an instance already unreachable
from the internet. Stated rather than left as an unmarked gap.

### 4. The URL entry lives under the prefix SCRUM-174 published

SCRUM-174 obligation 6. The task execution identity's parameter read grant is scoped to
`/crewsafe/shared-dev/*`, so an entry created anywhere else is unreadable — and the resulting
startup failure presents as an **authorization error rather than a naming one**, which is a much
harder thing to diagnose. The prefix is read from that component's outputs, never transcribed.

### 5. Values are derived, never literal

Both the connection URL and the narrowing grant's resource are derived from the instance. This is
what makes a restore recoverable: **a restore produces a new endpoint and a new service-managed
credential**, and a plan and apply re-derive both onto it.

A literal would survive the restore while silently addressing the instance that no longer exists —
with every resource looking correct in isolation. That is the most misleading failure this
component can produce, which is why the assertion uses sentinel values that a hard-coded
implementation would not track.

**Cost**: recovery time includes one CI plan-and-apply round trip. A restore alone does not
restore service, and the runbook states the two as one procedure.

### 6. Durable, not disposable

Single-AZ `db.t4g.micro`, gp3, encrypted, 7-day backup retention, deletion protection on, final
snapshot taken, `allow_destroy: false`. Every backend lane depends on this instance; losing its
data blocks all of them at once. Destroy is refused **twice** — by the catalogue guard, then by
deletion protection at the service.

**Cost**: teardown is a deliberate multi-step act, and the instance costs more than a disposable
one. Multi-AZ was rejected separately: it roughly doubles the cost for an environment with no
availability requirement in the plan's NFRs.

### 7. Storage grows, but within a ceiling

Automatic growth from 20 GiB to a 100 GiB ceiling. Both halves matter: growth without an apply so
a full disk is not an outage, and a finite ceiling so a runaway migration or seeding defect stops
somewhere a human must consciously raise rather than billing indefinitely.

**Cost**: at the ceiling, writes fail. That is the only refusal point a runaway consumer meets,
and there is no alerting before it — the first signal today is a write failure.

### 8. Minor versions advance automatically; the major version is pinned

`engine_version = "16"` — **the major version only** — with `auto_minor_version_upgrade = true`.

This is the crux of the no-perpetual-diff guarantee. With a fully pinned `16.4`, an automatic
upgrade to `16.6` would make every subsequent plan propose reverting it: diff noise that trains
reviewers to skim, which is worse than the drift it reports. Supplying the major version alone
means an automatic upgrade produces **no diff at all** — achieved without `ignore_changes`, which
the source guard forbids for exactly the reason it would otherwise be reached for.

**Cost**: the running minor version can drift from what any given plan showed, so the deployed
version is discovered from the instance rather than read from source.

### 9. Engine log exported; deeper telemetry deferred

The two failure modes **this component introduces** — a connection refused for lacking encrypted
transport, and an authentication failure after a rotation the service performs unannounced — are
invisible in default service metrics and visible in the engine log. It is exported under an
explicitly declared 7-day retention, because the service otherwise creates the log group
implicitly with **no expiry**.

Statement logging is deliberately absent, and its absence is asserted. This database will hold
worker names, site assignments, and acknowledgements; a statement log would capture those query
parameters into a log outside the database's own access controls.

Performance Insights and Enhanced Monitoring stay deferred — they answer *"why is this query
slow"* about a workload that does not exist until SCRUM-176 deploys, and Enhanced Monitoring adds
a second IAM surface to answer it.

## Narrowing the one compromise SCRUM-174 accepted

That component granted `secretsmanager:GetSecretValue` on the service-reserved `rds!` **prefix**
rather than a pinned ARN, because the service names the credential and it did not exist yet. It
published `task_execution_role_name` for exactly one reason: so this component could tighten it
once the real identifier existed.

This component attaches an additional inline policy to that role holding **one statement, one
action, one resource, no wildcard**, pinned to the actual credential. Removing the prefix grant is
a change to SCRUM-174's reviewed policy — a follow-up, not a drive-by edit from here.

> **Two components now write inline policies onto one role, and that is worth knowing.** Attaching
> an inline policy is an **upsert**: a shared name would silently replace the other component's
> grant, and the damage would surface later as an unrelated-looking `AccessDenied`. The names
> differ, and a test asserts this component's distinguishing prefix is present.

## Producer contract

Six outputs. None carries a value; every one is a host, a port, a name, or an ARN.

| Output | Consumed by |
| --- | --- |
| `db_instance_address` | Health probes, diagnostics, a future pooler |
| `db_instance_port` | Connection construction — published so no consumer hard-codes it |
| `db_name` | Connection construction |
| `master_user_secret_arn` | Compute — the task definition's `secrets` block |
| `db_url_parameter_name` | Compute — parameter injection. The **name**, so a restore is picked up |
| `db_subnet_group_name` | A later standby, replica, or restore landing in the same placement |

## Migrations: nothing is built here

The backend already runs Flyway in-process at startup (`spring.flyway.enabled: true`) with
`spring.jpa.hibernate.ddl-auto: validate`. There is no migration infrastructure to build — no
runner task, no build project, no container registry — and the source guard forbids adding any.

"Migrations run automatically on deploy" is therefore discharged as a **stated obligation
SCRUM-176 inherits**, in the same form SCRUM-173 and SCRUM-174 used. It is **verified when
SCRUM-176 deploys**, not at this component's apply, and SC-017 records that honestly rather than
claiming it is proven here.

## Obligations this component cannot enforce

Acceptance criteria of *this* issue whose enforcement lives in a consumer, recorded so SCRUM-176
inherits them explicitly rather than by hope.

1. **Do not disable, skip, or pre-empt the startup migration**, and do not loosen
   `ddl-auto: validate`. A deploy path that runs migrations separately and leaves the
   application's copy disabled breaks the guarantee behind this issue's second acceptance
   criterion.
2. **Place tasks in the private subnets and attach them to the application security group.**
   Membership is the *only* thing granting database access; a task placed elsewhere fails with a
   connection timeout rather than an authorization error — much harder to diagnose.
3. **Inject the credential by reference to `master_user_secret_arn`, never as a plaintext
   environment value.** A task definition carrying the password exposes it to anyone who can
   describe that task definition, undoing the whole design from the outside.
4. **Do not pin a version identifier** on the credential reference. The service rotates on its own
   schedule; a pinned reference turns a routine rotation into an outage.
5. **Tolerate an unannounced rotation.** A task holding a superseded value fails to authenticate;
   the recovery is replacing the task. A deploy path with no restart path makes this an outage.
6. **Read `db_url_parameter_name` at task start**; do not bake the resolved URL into an image.
7. **The cross-origin entry is still not created** by this component (FR-019). It belongs to
   whatever creates the web application's public origin.
8. **Removing SCRUM-174's prefix grant is a change to that component**, made once the pinned grant
   here is applied and verified.
9. **No build argument may carry a credential**, and no workflow may echo the URL's resolved
   value.

## Component registration

```json
"database-shared-dev": {
  "jira_key": "SCRUM-175",
  "root": "infra/terraform/database",
  "backend_strategy": "remote",
  "state_key": "crewsafe/database/shared-dev.tfstate",
  "allow_destroy": false
}
```

Registration is the entire CI integration — `terraform-validate.yml` builds its matrix from the
catalogue keys, so `fmt`, `validate`, and `terraform test` start running automatically. **No
workflow file was created or edited.**

`test-component-catalog.sh` asserts the exact set of catalogue keys, so adding a component
necessarily edits it — the same thing SCRUM-173 and SCRUM-174 found. The edits are **additive**:
the key set, a state-key assertion, a destroy-refusal assertion, and the lockfile-conditional
resolver check. No existing assertion was weakened.

## Testing

**20 `terraform test` runs plus a pure-shell source guard.** Everything runs offline against a
mocked provider; no AWS account is touched.

### The decision that makes the derivation tests meaningful

The assertions that the URL and the pinned grant are **derived** rather than literal work by
pinning sentinel values through `override_resource`:

```hcl
override_resource {
  target = aws_db_instance.main
  values = {
    address            = "db-sentinel.abc123.ap-southeast-1.rds.amazonaws.com"
    master_user_secret = [{ secret_arn = "...rds!db-sentinel-AbCdEf" }]
  }
}
```

A literal implementation would not track the override; a derived one does. That is what
distinguishes the two implementations rather than merely restating the configuration — the same
reasoning SCRUM-174 used when it chose `jsonencode()` over `data "aws_iam_policy_document"`, whose
`json` attribute a mock fabricates.

**One assertion was removed for failing this same test.** `kms_key_id` is computed when unset, so
a mocked provider fabricates it and any assertion over it would check invented data. That
guarantee moved to the source guard, which forbids `aws_kms_key` outright.

### Every guarantee was observed failing before it was trusted

Eighteen violations were planted, each caught, each reverted:

| Violation planted | Caught by |
| --- | --- |
| `publicly_accessible = true` | Assertion **and** source guard (SC-006) |
| `aws_security_group` declared | Source guard (FR-003) |
| `log_statement = "all"` | Assertion **and** source guard (SC-021) |
| Literal `password = "hunter2"` | Source guard (SC-004) |
| `random_password` | Source guard (SC-005) |
| A variable that could carry a password | Source guard (FR-012) |
| `aws_secretsmanager_secret` | Source guard (FR-013) |
| URL entry outside the published prefix | Assertion (SC-010) |
| Literal endpoint instead of derived | Assertion (SC-022) |
| Credential in the URL query string | Assertion (SC-011) |
| Narrowing grant widened to `Resource = "*"` | Assertion (SC-012) |
| Policy name colliding with SCRUM-174's | Assertion (R-010) |
| Extra action on the pinned grant | Assertion (FR-018) |
| Deletion protection off, final snapshot skipped | Assertion (SC-013) |
| Pinned minor engine version | Assertion (SC-025) |
| `ignore_changes = [engine_version]` | Source guard (R-008) |
| `null_resource` with `local-exec` running SQL | Source guard (FR-022) |
| Cross-origin entry created here | Source guard (FR-019) |

### What the tests could not catch

**Two applies failed, both on the hand-applied apply policy, and neither was detectable locally.**

| Run | Stopped at | Cause |
| --- | --- | --- |
| 30702539990 | log group | `logs:DescribeLogGroups` scoped to an ARN pattern — the action accepts no resource scope, so AWS evaluated it against `log-group::log-stream:` and denied it |
| 30702976625 | DB instance | No `iam:CreateServiceLinkedRole`. RDS needs `AWSServiceRoleForRDS`, which does not exist until an account's first instance |

`terraform validate`, `terraform test`, the source guard, and the plan **all accepted policies AWS
rejects.** None of them models the IAM authorization engine: which actions support resource-level
permissions, and which service-linked roles a resource needs before it can exist. This is a
structural blind spot in the component's testing, not an oversight in any one check.

**The second failure is the more instructive one**, because it does not look like a permissions
problem at all:

```text
InvalidParameterValue: Unable to create the resource. Verify that you have
permission to create service linked role. Otherwise wait and try again later
```

An `InvalidParameterValue` whose text invites you to wait and retry. Retrying without the
permission fails identically.

### Three lessons for SCRUM-176

1. **Before scoping an IAM action to a resource ARN, confirm the service supports resource-level
   permissions for it.** A tighter-looking policy that fails at apply is worse than a correct one,
   because the failure lands *after* resources have been created. The corrected policy isolates
   `logs:DescribeLogGroups` into its own single-action statement on `*` — the same containment
   SCRUM-174 used for `ecr:GetAuthorizationToken`, whose lesson this component had available and
   reproduced the mistake anyway.
2. **A resource that needs a service-linked role needs permission to create one, in every
   account.** Accounts are isolated per teammate (AGENTS.md §7), so each one bootstraps its own.
   ECS and ELB both use service-linked roles, so SCRUM-176 will hit this twice. The grant is
   narrow — one action, one exact ARN under `aws-service-role/<service>/`, plus an
   `iam:AWSServiceName` condition.
3. **Budget for two or three apply cycles when a component introduces a new AWS service.** The
   permissions cannot be fully derived from the Terraform source, and each round trip costs a
   merge plus a hand-applied policy update. SCRUM-173 needed one recovery cycle, this component
   needed two.

### Use Terraform 1.10.5 locally

`versions.tf` permits `>= 1.10, < 2.0`, but that constrains the configuration, not what CI runs.
CI pins **1.10.5** in four places; developing against a newer release passes locally and fails in
CI. This cost SCRUM-173 a cycle and SCRUM-174 restated it.

Assertion runs use `command = apply` because on 1.10.5 overrides are not surfaced during the plan
phase and `override_during` does not exist. A mocked apply creates nothing; it resolves computed
values so assertions can evaluate. The account-precondition run uses `command = plan`, because a
precondition is evaluated during planning — which is the point.

The lockfile was generated with
`terraform providers lock -platform=linux_amd64 -platform=darwin_amd64 -platform=darwin_arm64`,
not a bare `terraform init`. Its hash set is byte-identical to the network and secrets components'.

## Design constraints

- **Flat, literal HCL.** One directory, no reusable module, no third-party module.
- **6 resources** against a ceiling of 12: one subnet group, one parameter group, one log group,
  one instance, one configuration parameter, one narrowing role policy. Plus four data sources.
- **Inline role policy, not a managed policy with an attachment**, following SCRUM-174 FR-014.
- **No new `TF_VAR_`.** Placement, the configuration prefix, and the role name all come from
  remote state; the username comes from the secrets component's own parameter. The plan role
  already holds `s3:GetObject` on `crewsafe/*` and `ssm:GetParameter`, so no IAM change was needed
  to read any of them.

### Deferred, not dropped

Multi-AZ; read replicas; a managed connection proxy; IAM database authentication; a
customer-managed key; Performance Insights and Enhanced Monitoring; alerting and dashboards over
the exported log; cross-region snapshot copying; a stable private DNS name in front of the
instance so consumers survive a restore without an apply; and a separate least-privilege
application database role distinct from the master user.

> **The application connects as the master user, and that has a cost.** Creating a restricted role
> needs SQL executed against the instance, which FR-022 forbids from Terraform and which has no
> bastion path today. A SQL-injection defect would therefore be more damaging than it would be
> against a restricted role. Accepted for a shared development environment holding synthetic data;
> a defensible follow-up once a migration-based grant path exists.
