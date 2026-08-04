# Implementation Plan: Backend Compute Runtime and Staging DNS

**Branch**: `feat/scrum-176-backend-compute-runtime` | **Date**: 2026-08-02 | **Spec**: the local specification

**Jira**: SCRUM-176 (subtask of SCRUM-142) · **Component**: `compute-shared-dev`

**Input**: Promoted from the local Spec Kit working area (`specs/008-backend-compute-runtime/`,
gitignored) per `AGENTS.md` §6.3. The specification, research, data model, task list, and quickstart
that produced this plan are not committed; the durable decisions are here and in the
[runbook](../runbooks/SCRUM-176-backend-compute-runtime.md).

## Summary

> **SUPERSEDED 2026-08-04.** The internal-load-balancer-plus-CloudFront-VPC-origin architecture
> described below was built and applied twice; both applies produced a distribution that reported
> healthy and served zero requests, for reasons that were never diagnosable from Terraform or from
> AWS's own network tooling. It was abandoned in favor of a public load balancer fenced by
> CloudFront's managed prefix list — the alternative this plan's Constitution Check considered and
> rejected below. This section is kept in full as the record of that original decision and its
> reasoning; the current architecture, the full diagnostic account, and what the change concedes are
> in the [runbook](../runbooks/SCRUM-176-backend-compute-runtime.md) §1 and §10.

Run the existing `com.crewsafe` Spring Boot backend on ECS Fargate in the private subnets
`network-shared-dev` published, attached to the application security group that component created,
with every credential and every configuration value resolved **by reference** at task start using
the two roles `secrets-shared-dev` published. Front it with an **internal** load balancer reached
only through a CloudFront VPC origin, so the public entry point has a publicly trusted certificate
on a provider-issued name while the origin has no public address at all. Create the cross-origin
configuration entry SCRUM-174 and SCRUM-175 both deferred.

**Fourteen resources.** As with its predecessors, the interesting properties are absences: no image
repository (SCRUM-177 owns it), no plaintext credential, no version-pinned secret reference, no
`NEA_API_KEY` entry, no Flyway or DDL override, no public address on anything but the distribution,
and no CIDR in any security group rule.

**Two boundaries this plan draws that the issue did not.** First, image packaging and the registry
belong to SCRUM-177, whose two pull requests are open and whose acceptance criterion names this issue
as the consumer; this component verifies what it consumes rather than building it. Second, Terraform
owns the infrastructure and **CI owns the deployment** — the shared workflows cannot pass a
per-component image tag, so the service declares `ignore_changes` on its task definition and
SCRUM-145 deploys with `force-new-deployment`.

## Technical Context

**Language/Version**: Terraform HCL. `required_version = ">= 1.10, < 2.0"`; **develop against
1.10.5**, the version CI pins. The workstation currently reports 1.15.8 on `darwin_arm64` — both
halves of the trap that is presently red on pull request #40 (research.md R-002).

**Primary Dependencies**: `hashicorp/aws ~> 6.0`, lockfile pinned to **6.57.1** matching `network`,
`secrets`, and `database`. `aws_cloudfront_vpc_origin`, `vpc_origin_config`,
`deployment_circuit_breaker`, and both managed-policy data sources verified present in that exact
binary (R-003). Four `terraform_remote_state` reads: `network-shared-dev`, `secrets-shared-dev`,
`database-shared-dev`, `ecr-shared-dev`.

**Storage**: None owned. Terraform state: S3 backend, key `crewsafe/compute/shared-dev.tfstate`. One
CloudWatch log group, `/crewsafe/shared-dev/backend`, 14-day retention. One SSM `String` parameter.

**Testing**: `terraform test` against `mock_provider "aws"` (offline, no account), with
`override_data` for the four remote states — those belong to the built-in `terraform` provider, which
`mock_provider "aws"` does not cover. Plus a pure-shell source guard,
`.github/scripts/terraform/tests/test-compute-source-guard.sh`, for categorical absences a mocked
plan cannot express (R-010). No new test tooling.

**Target Platform**: AWS `ap-southeast-1`, one shared development deployment. ECS Fargate,
`LINUX/X86_64`, matching #41's image.

**Project Type**: Terraform infrastructure component — the seventh in this repository, the sixth
following the `remote` backend pattern.

**Performance Goals**: Inherited from the application (reads <1s p95, state-changing <2s p95). This
component's contribution is the distribution plus the in-region hop, well under 100 ms. A cold-start
task must reach healthy inside the grace period including migrations (PERF-004).

**Constraints**: No credential in source, state, plan artifact, image, task definition, or log. No
local Terraform. No modification of any upstream component except the one inbound rule SCRUM-173
delegated. No change to the shared plan/apply workflows or their guard tests (FR-047). Resource
ceiling 22.

**Scale/Scope**: One cluster, one service, one task, one container. Two availability zones of
placement capacity for a `desired_count` that defaults to 1.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Initial evaluation (pre-research)

| # | Gate (source principle) | Status |
| --- | --- | --- |
| I | **Maintainable Code Quality** | PASS — one directory of flat resources, no module abstraction, following `infra/terraform/database` file for file. Every input validated. The ECS-over-App-Runner decision is recorded in the spec with the rejected alternative and its cost; it is a *simpler* option declined, so it belongs there rather than in Complexity Tracking. |
| II | **Secure by Design** | PASS — deny-by-default placement, credentials by reference only, no secret in state, least-privilege plan/apply policy documents, and negative tests demonstrated failing (SC-012). |
| III | **Test-First Evidence** | PASS — 29 success criteria written before any implementation; `/speckit-tasks` must order the mocked tests and the source guard before the resources they constrain. |
| IV | **Consistent and Accessible UX** | N/A for an interface, PASS as recorded — no UI is delivered. The spec's UX table covers the operator journeys, and UX-002 assigns the WCAG obligation to the client issues that will consume this endpoint. |
| V | **Measured Performance and Reliability** | PASS — PERF-001..004 and REL-001..005 are stated with targets or explicit inheritance; REL-003 records the single-task availability gap rather than assuming it away. |
| — | **Engineering and Safety Constraints** | PASS — within plan §10.3 (ECS Fargate, ALB, CloudFront, ECR all named there). CI-only Terraform, remote state with locking, `allow_destroy: false`. No probabilistic component involved. |

### Re-evaluation (post-design)

| # | Gate | Status after Phase 1 |
| --- | --- | --- |
| I | Maintainable Code Quality | PASS — 14 resources against a ceiling of 22. Two managed policies referenced as data sources rather than authored (R-004). No duplicated business rule; the one duplication accepted repo-wide (the state bucket naming convention) is inherited unchanged. |
| II | Secure by Design | **PASS, with FR-032 discharged by follow-up** — see below. |
| III | Test-First Evidence | PASS — the local quickstart §2 enumerates eleven planted violations, each with the guard or assertion expected to catch it, to be observed failing before the pull request opens. |
| IV | Consistent and Accessible UX | N/A / PASS — unchanged by the design. |
| V | Measured Performance and Reliability | **PASS with one open measurement** — the 180s grace period is an estimate; FR-026 and SC-026 require it measured on first apply and the default adjusted. Tracked as open item 2. |
| — | Engineering and Safety Constraints | PASS — `aws_cloudfront_vpc_origin` verified in the pinned provider (R-003), so the design does not depend on an unavailable feature. Mandatory plan-review checks are enumerated in the local quickstart §3 because a clean plan does not prove every server-side constraint. |

**The Gate II item, stated rather than buried.** FR-032 requires the execution and task roles to be
pinned to this cluster, discharging a deferral SCRUM-174 recorded. FR-053 forbids this component from
modifying resources `secrets-shared-dev` owns. Those collide: a role's `assume_role_policy` is an
*attribute* of another component's resource, not a separately attachable one — unlike
`aws_iam_role_policy`, which is why SCRUM-175 could add a pinned grant from outside.

**Resolved by the reviewer on 2026-08-02: R-009 option 1.** This component publishes `cluster_arn`
as a fifth output, annotated with the reason it exists, and raises a follow-up against SCRUM-174 to
apply the condition. FR-032 is therefore **discharged by follow-up, not satisfied here** — obligation
16 makes raising it a condition of this issue rather than a note, because the choice is only sound if
the follow-up exists. **Raised as [SCRUM-191](https://u-team-h6ii4x03.atlassian.net/browse/SCRUM-191)**
(blocked by this issue, relates to SCRUM-174).

The interim posture, which the runbook must state: the two roles are assumable by the ECS tasks
service principal account-wide, in an account holding exactly one cluster under CI-only Terraform.
The exposure is bounded today and grows the moment a second cluster exists.

## Project Structure

### Documentation (this feature)

Produced locally under `specs/008-backend-compute-runtime/` (gitignored): `spec.md` (54 functional
requirements, 29 success criteria, 16 obligations), `research.md` (R-001–R-013), `data-model.md`,
`contracts/terraform-outputs.md`, `quickstart.md`, `tasks.md` (86 tasks), and a spec-quality
checklist. This plan and the runbook are what survive.

### Source (repository root)

```text
infra/terraform/compute/                    # NEW — the component
├── backend.tf                              # terraform { backend "s3" {} }
├── versions.tf                             # required_version, aws ~> 6.0, default_tags Jira=SCRUM-176
├── variables.tf                            # 11 variables, all validated; 3 supplied by CI
├── main.tf                                 # 14 resources + 4 remote states + 2 managed policies
├── outputs.tf                              # 4 outputs, per contracts/terraform-outputs.md
├── .terraform.lock.hcl                     # generated with -platform=linux_amd64 (R-002)
├── iam/
│   ├── plan-role-policy.json               # -> inline policy CrewSafeComputeTerraformPlan
│   └── apply-role-policy.json              # -> inline policy CrewSafeComputeTerraformApply
└── tests/
    └── compute.tftest.hcl                  # mocked-provider assertions

.github/terraform/components.json           # MODIFIED — add compute-shared-dev
.github/scripts/terraform/tests/
├── test-component-catalog.sh               # MODIFIED — add the key to the hard-coded set
└── test-compute-source-guard.sh            # NEW — categorical absences (R-010)

docs/plans/SCRUM-176-backend-compute-runtime-plan.md      # NEW — promoted from this file
docs/runbooks/SCRUM-176-backend-compute-runtime.md        # NEW — dispatch, review, recovery
AGENTS.md                                   # MODIFIED — §4 Java 17→21, §5 backend is on main
```

**Structure Decision**: One flat component directory mirroring `infra/terraform/database`, registered
in the catalogue so `terraform-validate.yml` picks it up from the matrix. **No workflow file is
added** — that is the SCRUM-173 precedent and FR-047 forbids touching the shared workflows.

`backend/` is **not** modified. Every value the deployment needs is already read from the environment
(FR-040). `backend/Dockerfile` belongs to SCRUM-177 (FR-005).

## Resource inventory

Fourteen, against a ceiling of 22 (SC-018). Full table with requirement mapping in
research item R-013; field-level detail in the local data model.

| Group | Resources |
| --- | --- |
| Runtime | `aws_ecs_cluster`, `aws_ecs_task_definition`, `aws_ecs_service` |
| Observability | `aws_cloudwatch_log_group` |
| Access control | `aws_security_group` (LB), 2 rules on it, **1 ingress rule on the network component's app group** |
| Origin | `aws_lb` (**internal**), `aws_lb_target_group`, `aws_lb_listener` |
| Public edge | `aws_cloudfront_vpc_origin`, `aws_cloudfront_distribution` |
| Configuration | `aws_ssm_parameter` (cross-origin entry) |

Plus 4 `terraform_remote_state` data sources and 2 managed-policy data sources.

## Execution sequence

Test-first ordering; `/speckit-tasks` expands this into numbered tasks.

1. **Toolchain first.** Install Terraform 1.10.5. Verify before writing anything — R-002 exists
   because this step has been skipped twice.
2. **Catalogue registration and the guard test**, so `terraform-validate.yml` picks the component up
   from the first push.
3. **Source guard** (`test-compute-source-guard.sh`), written against an empty component directory so
   it starts by passing vacuously, then each forbidden construct planted and observed failing.
4. **Skeleton**: `versions.tf`, `backend.tf`, `variables.tf` with every validation, `outputs.tf` with
   the four outputs. `terraform validate` passes.
5. **Mocked tests** (`compute.tftest.hcl`) with the four `override_data` blocks and every assertion
   from the success criteria — **failing**, because no resource exists yet.
6. **Resources**, in dependency order: log group → LB security group and its two rules → the one app
   group ingress rule → internal LB, target group, listener → VPC origin → distribution → cluster →
   task definition → service → cross-origin parameter. Tests go green in groups.
7. **IAM policy documents**, derived from the resource set once it is final. They are
   **hand-applied** as inline policies named `CrewSafeComputeTerraformPlan` and
   `CrewSafeComputeTerraformApply` — merging changes nothing in AWS until someone attaches them, and
   the names are an upsert, so reusing another component's name silently deletes its permissions.
   Full procedure in the runbook §3.
8. **Lock file** with `-platform=linux_amd64`.
9. **Prove the guards bite** — the local quickstart §2, eleven planted violations, output captured for the
   pull request.
10. **Documentation**: promote to `docs/plans/`, write `docs/runbooks/`, correct `AGENTS.md` §4 and
    §5.

## Post-merge operational sequence

Ordering is forced by SCRUM-177; only the apply waits.

0. Attach `CrewSafeComputeTerraformPlan` (inline) and `CrewSafeComputeTerraformApply`
   (**customer-managed** — the apply document exhausted the role's 10,240-char inline budget),
   substituting `<ACCOUNT_ID>` eight times in the apply document (runbook §3).
1. ✅ #40 merges → apply `ecr-shared-dev` → set the `CREWSAFE_ECR_*` repository variables.
2. ✅ #41 merges → first image published to `crewsafe/backend`.
3. ✅ Set `var.initial_image_tag`'s default to that image's commit SHA —
   `af7727812ee82bb74afc172fa6e5d4b865752152`. The rebase this step also called for is moot: both
   catalogues landed on `main` together, so there was no conflict to resolve.
4. Dispatch **Terraform State Plan** for `compute-shared-dev`.
5. **Mandatory plan-review checks** — the local quickstart §3, twelve items. A clean plan does not prove
   every server-side constraint; items 10 (no apostrophe in a security group description) and 6
   (writable root, no volume, no `/tmp` mount — **inverted 2026-08-03**, see the runbook §10) are the two that have a track record of failing after a
   clean plan.
6. Dispatch **Terraform State Apply** with the reviewed `plan_run_id` and the typed confirmation.
7. Post-apply verification — the local quickstart §4, SC-001 to SC-010.
8. **Measure the cold start** and adjust the grace period default (SC-026).
9. Hand deploys to SCRUM-145.

## Obligations carried forward

Full list in the spec (16 obligations). The four that most affect the next issue:

- **SCRUM-145 deploys with `force-new-deployment`, never a Terraform apply**, and names a commit-SHA
  tag. Q4 hands it ownership of every task-definition revision after the first, so FR-004 is enforced
  by a person there rather than by variable validation here.
- **SCRUM-145 must not "fix" the declared `ignore_changes` divergence** (FR-042). It is deliberate,
  annotated, and asserted.
- **SCRUM-177 must keep publishing a commit-SHA tag** and keep the repository under `crewsafe/*`.
- **SCRUM-144 must not re-path `/actuator/health` or change its success semantics** without updating
  the target group probe.
- **SCRUM-191** pins the roles' trust condition to the published `cluster_arn`, discharging FR-032
  (obligation 16). Raised 2026-08-02.

## Deferred, with the gap stated

Autoscaling; more than one running task; a web application firewall; access logging from the
distribution or the load balancer; alarms, dashboards, and metric filters; distributed tracing;
Container Insights; blue/green deployment; a custom domain; a connection pooler; a bastion path.

Two deferrals worth naming because a reader may assume otherwise:

- **`NEA_API_KEY` is not in the task definition.** The secret has no version and a reference to a
  versionless secret fails the task start, so including it would make every deploy fail while the key
  is unset — which is today's state. Enabling it later is a task-definition change, not just a secret
  write (R-005).
- **A single task means a restart gap.** With `desired_count = 1` there is no redundancy; the
  platform restarts and the service is unavailable for that duration. Accepted for a shared
  development environment and recorded (REL-003), not assumed away.

## Complexity Tracking

No constitution gate is FAIL, so no entry is required. One item is recorded here because it is a
*conflict between two requirements* rather than a complexity justification, and a reader looking for
unresolved risk should find it in both places.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| FR-032 (pin the roles to this cluster) collides with FR-053 (do not modify upstream components) | SCRUM-174 recorded the pinning as a deferral to be discharged once a cluster existed; the cluster now exists | A role's `assume_role_policy` is an attribute of a `secrets-shared-dev` resource, not a separately attachable one. SCRUM-175 could add a pinned grant from outside only because `aws_iam_role_policy` *is* separate. **Resolved 2026-08-02, R-009 option 1**: publish `cluster_arn`, apply the condition in a follow-up against SCRUM-174. The two rejected options — a dormant variable on a `Done` component, and dropping FR-032 outright — are recorded in R-009. |
