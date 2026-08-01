# SCRUM-174 — Secrets Management and IAM Roles

**Jira**: [SCRUM-174](https://u-team-h6ii4x03.atlassian.net/browse/SCRUM-174) (subtask of
SCRUM-142) · **Component**: `secrets-shared-dev` · **Runbook**:
[SCRUM-174-secrets-and-iam.md](../runbooks/SCRUM-174-secrets-and-iam.md)

## Summary

The fourth Terraform component. It defines **where every deployed credential and configuration
value lives, and who may read it**: one empty Secrets Manager container for the weather API
key, seven Parameter Store entries for non-secret configuration, and two IAM roles — a task
execution identity and a task identity — whose read permissions are scoped to exactly those
entries.

The component is 12 resources of flat HCL. Its interesting property is not a resource but an
**absence**: Terraform manages secret *containers* and never secret *versions*, so no credential
value can enter Terraform state. Everything else in the design exists to make that absence
provable.

## The central decision: containers, not values

The issue's acceptance criterion is that `terraform show` exposes no credential. The obvious
approach — mark outputs and variables `sensitive` — **does not achieve this**. `sensitive`
suppresses console rendering while the value sits in plaintext in the state object, which lives
in S3 and is readable by anyone with `s3:GetObject` on the bucket. A leaked state file is not a
leak that can be retracted.

So the guarantee is structural. These constructs are forbidden in the component and a shell
source guard enforces it:

| Forbidden | Why |
| --- | --- |
| `aws_secretsmanager_secret_version` | Writes the value into state |
| `random_password` / `random_string` / `random_id` | Generates a value into state |
| `aws_ssm_parameter` with `type = "SecureString"` | Same, and encrypting a non-secret obscures which values are actually sensitive |
| `data "aws_secretsmanager_secret_version"` | Reading is as damaging as writing |
| `data "aws_ssm_parameter"` | Same |
| `aws_kms_key` | A second authorization surface the IAM tests do not inspect |
| `aws_iam_role_policy_attachment` | A managed policy would silently restore account-wide access |
| `ignore_changes` on a `value` or `secret_string` | Holds a stale value in state and hides genuine drift |

This works because **no credential's value is knowable to this component and never will be**.
The weather API key is issued by data.gov.sg to a human. The database master password is
generated inside the managed database service. The constraint is natural rather than contrived.

It is the same discipline SCRUM-154 applied: that component granted the CI role
`secretsmanager:PutSecretValue` scoped to a synthetic-user path so a *workflow* could write
values, while Terraform itself never held one.

### A second, independent guarantee

Neither the plan role nor the apply role is granted `secretsmanager:GetSecretValue`. The CI
roles create and describe containers and can never read a value, so `terraform plan` cannot
produce a diff containing a credential **even if every other control here were wrong**. This
does not depend on the source guard being correct.

## Scope decisions

### 1. The database master credential is owned by the managed database service

The database component enables RDS's managed master password, so the service generates, stores,
and natively rotates it. This component declares **no container for it**.

The alternative — this component declares a container, a workflow writes a value, and the
database component reads it to set `password` — was rejected because that read materialises the
credential into the **database component's** state. It would move the violation one issue
downstream rather than remove it.

**Cost**: the read grant for that secret must be a path prefix (`rds!*`) rather than a pinned
ARN, because the service names the secret and it does not exist until the database does. This is
bounded three ways: `rds!` is a prefix AWS reserves and no customer secret can occupy, so the
grant cannot be widened by creating a similarly named secret; a test asserts it stays the only
grant outside this component's naming scope; and the published `task_execution_role_name` lets
the database component attach a precisely pinned grant once the real ARN exists.

### 2. The default AWS-managed encryption key, not a customer-managed key

Authorization stays in exactly one place — the two IAM read policies — rather than being split
with a key policy the negative tests do not inspect. A CMK would add a second surface that can
be widened by mistake, for a shared development environment that has no cross-account
requirement. **Cost**: cross-account access to these secrets would require adding a key later.

### 3. An entry whose value exists later is owned by the producing component

The database URL's value does not exist until the database does. The database component creates
that entry under the prefix this component publishes.

The alternative — a placeholder here with `ignore_changes = [value]` — was rejected because it
holds a stale value in state and suppresses drift detection on the same field, including drift
nobody intended. **Cost**: the configuration set is incomplete until SCRUM-175 lands, and the
application cannot start on this component alone. That is correct rather than a gap — it cannot
start without a database either.

### 4. Seven configuration entries, not thirteen

A value earns an entry only where the deployed environment must **differ from the default the
application already carries**. The server port, the weather freshness thresholds, the ingestion
interval, and the external weather API base URL all keep their application defaults. Restating a
default creates a second place the value lives and a second thing to keep in sync, for no
behavioural difference.

| Entry | Why it must differ |
| --- | --- |
| `db/username` | The local default is not the deployed master user |
| `cognito/issuer-uri`, `cognito/jwk-set-uri`, `cognito/client-ids` | Required; `application.yml` deliberately gives them no default so a deployment that forgets one dies at startup naming the property |
| `cors/allowed-origins` | Defaults to localhost dev servers |
| `spring/profiles-active` | Must not be `local` |
| `weather/ingestion-enabled` | Defaults off so a developer machine never calls a live safety-data service |

## Two exceptions to least privilege, both stated plainly

Every grant in this component is an exact ARN under its naming scope, or a wildcard under that
scope — except two. Both are asserted to stay exactly one.

| Exception | Why it cannot be narrower | Bounded by |
| --- | --- | --- |
| `secretsmanager:GetSecretValue` on `rds!*` | The service names the secret; it does not exist until the database does | AWS reserves the `rds!` prefix; a test asserts this stays the only grant outside the naming scope |
| `ecr:GetAuthorizationToken` on `*` | The ECR API accepts **no** resource scope for this action — AWS's own `AmazonECSTaskExecutionRolePolicy` is written the same way | A test asserts exactly one wildcard statement exists, holding exactly one action, and that the action is this one |

### This required correcting the specification

FR-011 originally forbade a resource wildcard without exception, which **no correct
implementation could satisfy**. The requirement was wrong, not the design. It was amended to add
a single named exemption, and the blanket "no wildcard" assertion was split into three precise
ones.

The amendment makes the guarantee *stronger*. The original wording would have been either
violated in silence or "satisfied" by attaching the AWS managed policy — which grants image and
log access across the **entire account**. Writing the platform statements out by hand is what
turns those into prefix-scoped grants, and it is why the exemption is one action rather than
five.

## Producer contract

Five outputs. None carries a value; every one is an identifier or a path.

| Output | Consumed by |
| --- | --- |
| `weather_api_key_secret_arn` | Compute — secret injection |
| `config_parameter_prefix` | Compute — parameter injection; database — where to write the URL |
| `task_execution_role_arn` | Compute — `executionRoleArn` |
| `task_role_arn` | Compute — `taskRoleArn` |
| `task_execution_role_name` | Database — attaching a pinned credential grant later |

## Obligations this component cannot enforce

Acceptance criteria of *this* issue whose enforcement lives in a consumer. They are recorded so
the consuming issues inherit them explicitly rather than by hope.

1. **The compute component MUST inject secrets by reference, never as plaintext.** A task
   definition carrying a credential in its `environment` list exposes it to anyone who can
   `DescribeTaskDefinition`, regardless of how carefully it was stored here. This is the single
   most likely way "none baked into an image" gets violated.
2. **The compute component MUST attach exactly the two published identities** and MUST NOT add a
   broad managed policy alongside them.
3. **The compute component MUST NOT pin a version identifier** when referencing a secret;
   pinning makes rotation require a task-definition change.
4. **The database component MUST enable the service's managed master password** and MUST NOT set
   a password Terraform can see. A `random_password` there is exactly as damaging as one here,
   and it is the likeliest way this design is undone — because setting a password explicitly is
   the more obvious thing to write.
5. **The database component MUST create the database URL entry under `config_parameter_prefix`.**
   A different prefix is not covered by the read grant, and the application fails to start with
   what looks like a permissions bug rather than a naming one.
6. **No image build step may accept a credential as a build argument.** Build arguments persist
   in image metadata.
7. **CI workflows must never echo a value.**

## Component registration

```json
"secrets-shared-dev": {
  "jira_key": "SCRUM-174",
  "root": "infra/terraform/secrets",
  "backend_strategy": "remote",
  "state_key": "crewsafe/secrets/shared-dev.tfstate",
  "allow_destroy": false
}
```

Registration is the entire CI integration — `terraform-validate.yml` builds its matrix from the
catalogue keys, so `fmt`, `validate`, and `terraform test` start running automatically. **No
workflow file was created or edited.**

### One existing guard test required updating

`test-component-catalog.sh` asserts the exact set of catalogue keys, so adding a component
necessarily edits it — the same thing SCRUM-173 found. A destroy-refusal assertion was added for
the new component alongside the existing one for the network.

This means the specification's SC-011 ("existing guard tests continue to pass **unchanged**") is
not achievable as written, and was not achievable for SCRUM-173 either. The *spirit* holds —
adding a component must not weaken any guard — but the letter should be restated for the next
component that copies this pattern.

## Testing

15 `terraform test` runs plus a pure-shell source guard. Everything runs offline against a
mocked provider; no AWS account is touched.

### The decision that makes the IAM tests meaningful

Policies are composed as HCL objects rendered with `jsonencode()`, **not** with
`data "aws_iam_policy_document"`. Under `mock_provider` that data source's `json` attribute is
fabricated by the mock, so every assertion about policy content would be checking invented data
and passing meaninglessly. A `jsonencode()` of configuration is pure Terraform computation,
identical under a mock and against the real provider.

The assertions decode the policy actually attached to each role, which is stricter still: it is
the document that would really be sent to AWS.

### Two negative tests, in two harnesses

They live in different places because they prove different kinds of thing.

| Test | Harness | Proves | Observed failing against |
| --- | --- | --- | --- |
| Source guard | Pure shell | No forbidden *resource type* is declared | A planted `aws_secretsmanager_secret_version` with a literal value |
| IAM scope | `terraform test` | The policy *content* is correctly scoped | A read statement widened to `Resource = "*"` |

A `terraform test` assertion cannot express "no resource of this type exists anywhere" — its
assertions run over resources the configuration *does* declare, so a forbidden type is invisible
to it precisely when someone has added one. Grep is the right tool for a categorical absence;
`terraform test` is the right tool for policy content, because `Resource = "*"` is legitimate in
exactly one statement and the check must understand structure.

### Every guarantee was observed failing before it was trusted

| Violation planted | Caught by |
| --- | --- |
| `aws_secretsmanager_secret_version` with a literal value | Source guard (FR-005) |
| `random_password` | Source guard (FR-005) |
| `aws_kms_key` | Source guard (FR-030, SC-015) |
| `aws_iam_role_policy_attachment` | Source guard (FR-014) |
| `data "aws_secretsmanager_secret_version"` | Source guard (FR-005) |
| `type = "SecureString"` | Source guard (FR-003, FR-005) |
| `ignore_changes = [value]` | Source guard (FR-031) |
| `secretsmanager:GetSecretValue` in a CI role policy | Source guard (FR-026) |
| Secrets read widened to `Resource = "*"` | Three assertions: SC-006, SC-016 count, SC-016 action |
| A grant to a foreign out-of-scope secret path | SC-014 |
| `secretsmanager:PutSecretValue` on an identity | SC-007 |
| `Principal = { AWS = "*" }` in a trust policy | FR-013 |
| Task role granted a parameter read | FR-010, FR-015 |

### Use Terraform 1.10.5 locally

`versions.tf` permits `>= 1.10, < 2.0`, but that constrains the configuration, not what CI runs.
CI pins **1.10.5**; developing against a newer release passes locally and fails in CI. This cost
SCRUM-173 a cycle. The lockfile must likewise be generated with
`terraform providers lock -platform=linux_amd64 -platform=darwin_arm64 -platform=darwin_amd64`,
not a bare `terraform init` — its hash set is byte-identical to the network component's.

Assertion runs use `command = apply` because on 1.10.5 overrides are not surfaced during the
plan phase, and `override_during` does not exist until a later release. A mocked apply creates
nothing; it resolves computed values so assertions can evaluate.

## Design constraints

- **Flat, literal HCL.** One directory, no reusable module, no third-party module.
- **12 resources** against a ~15 budget: 1 secret container, 7 parameters, 2 roles, 2 inline
  role policies.
- **Inline role policies, not managed policies with attachments.** An inline policy cannot be
  attached to another principal by accident and is deleted with its role.
- **No new `TF_VAR_`.** The Cognito values come from `terraform_remote_state`, with the bucket
  name derived from the convention in `resolve-terraform-account.sh:62`. The plan role already
  holds `s3:GetObject` on `crewsafe/*`, so no IAM change was needed either. The cost is that the
  bucket-naming convention now lives in two places — accepted because a divergence fails loudly
  at `init` rather than silently producing wrong values.

### Deferred, not dropped

Automatic rotation schedules and rotation functions; cross-account secret sharing; cross-region
replication; per-environment namespaces beyond `shared-dev`; an `aws:SourceArn` condition on the
role trust policies (the ECS cluster it would name does not exist yet — the compute component
should add it).
