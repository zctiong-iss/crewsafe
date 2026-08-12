# Implementation Plan: Web Static Hosting Runtime and Staging Origin

**Branch**: `feat/scrum-298-web-compute-runtime-staging-origin` | **Date**: 2026-08-10 | **Spec**:
the local specification

**Jira**: SCRUM-298 (subtask of SCRUM-145) · **Component**: `compute-shared-dev` (extended, not new)

**Input**: Promoted from the local Spec Kit working area (`specs/022-web-compute-runtime/`,
gitignored) per `AGENTS.md` §6.3. The specification, clarifications, research, data model, task
list, and quickstart that produced this plan are not committed; the durable decisions are here and
in the [runbook](../runbooks/SCRUM-298-web-compute-runtime.md).

## Summary

Give the web frontend a stable, independently-reachable HTTPS staging origin by adding a private
S3 bucket and a second CloudFront distribution to the existing `compute-shared-dev` component —
reached only through Origin Access Control, never a public bucket endpoint. No container, no ECS
service, no ALB involvement: `web/` is a plain client-rendered Vite SPA with no server-side
runtime need, confirmed by reading `web/package.json` and `web/vite.config.ts` directly, and that
finding is what moved this component from its first-pass answer (extend the shared ALB) to Shape C
during `/speckit-specify`.

**Eleven new resources, one new data source, zero remote-state reads.** The interesting property,
as with every predecessor in this chain, is what is absent: no ECS task, no target group, no
health-check-driven target-group failover, no writable-scratch/non-root-user tradeoff, no
deployment circuit breaker — none of SCRUM-176's compute-specific machinery has a job here, because
there is no compute. What replaces "health check drives service healthiness" is stated plainly in
the spec (User Story 2) rather than silently dropped: a static origin has no "unhealthy target"
state, and this plan does not invent one.

**One boundary this plan draws that the issue's original conditional wording left open.** The
now-orphaned `crewsafe/web` ECR repository and `web-ci.yml`'s image-build/push/scan job are
untouched — retiring or repurposing either is a required follow-up (FR-018/FR-019), not this
component's decision. **A second boundary, resolved during `/speckit-clarify`**: the initial
deployment's sync is performed by a manually-dispatched GitHub Actions `workflow_dispatch` run via
OIDC (FR-017), never an operator's local AWS CLI session — keeping every credential in CI even for
the one operation this component cannot fully automate.

## Technical Context

**Language/Version**: Terraform HCL. `required_version = ">= 1.10, < 2.0"`; develop against
**1.10.5**, matching CI's pin and `infra/terraform/compute/.terraform.lock.hcl`'s existing
lockfile — no regeneration needed.

**Primary Dependencies**: `hashicorp/aws ~> 6.0`, already locked to **6.57.1** by the existing
component. `aws_s3_bucket*`, `aws_cloudfront_origin_access_control`, and `custom_error_response`
are long-GA surface at that version — no live-apply verification risk comparable to SCRUM-176's
`aws_cloudfront_vpc_origin`.

**Storage**: One new S3 bucket (`crewsafe-shared-dev-web`), versioned, SSE-encrypted, all public
access blocked, `BucketOwnerEnforced` ownership, noncurrent versions expired after 30 days.
Terraform state: same existing key, `crewsafe/compute/shared-dev.tfstate` — no new state file.

**Testing**: `terraform test` against `mock_provider "aws"`, extending the existing
`compute.tftest.hcl` (22 runs total: 15 pre-existing + 7 new — one more than originally planned,
see Implementation Notes). Plus new planted-violation assertions in the existing
`test-compute-source-guard.sh` (44 checks total).

**Target Platform**: CloudFront is a global service (no region binding for the distribution
itself); the bucket is `ap-southeast-1`, matching every other component's region constraint.

**Constraints**: No credential in source, state, plan artifact, or log. No local Terraform, no
local AWS CLI session for the sync (FR-017). No modification of any resource
`aws_lb.public`/`aws_ecs_cluster.main`/`aws_cloudfront_distribution.main` already own (FR-014). No
change to the shared plan/apply workflows (FR-022) — the one new input this feature needs,
`github_oidc_main_subject`, is already passed by them. The apply role's IAM budget was tight enough
to require a **second** customer-managed policy rather than growing the existing one.

**Scale/Scope**: One bucket, one distribution, one OAC, one bucket policy, one sync role.

## Constitution Check

No gate is FAIL, pre- or post-design. Full six-gate table with reasoning is preserved in the local
`plan.md` at the time of promotion; summarized here:

| # | Gate | Status |
| --- | --- | --- |
| I | Maintainable Code Quality | PASS — 11 resources + 1 data source, extends a reviewed file in place |
| II | Secure by Design | PASS — private bucket, OAC-only, least-privilege OIDC-only sync role, no open item |
| III | Test-First Evidence | PASS — 8 planted violations, all confirmed caught (§ Implementation Notes) |
| IV | Consistent and Accessible UX | N/A / PASS — no UI delivered |
| V | Measured Performance and Reliability | PASS — SC-001's 15-minute figure derived from CloudFront's documented behavior, no open measurement |
| — | Engineering and Safety Constraints | PASS — all resource types GA at the pinned provider version |

## Resource inventory

Eleven, plus one new data source. Confirmed by direct count against the applied source
(`docs/runbooks/SCRUM-298-web-compute-runtime.md` §1):

| Group | Resources |
| --- | --- |
| Storage | `aws_s3_bucket`, `aws_s3_bucket_versioning`, `aws_s3_bucket_server_side_encryption_configuration`, `aws_s3_bucket_ownership_controls`, `aws_s3_bucket_public_access_block`, `aws_s3_bucket_lifecycle_configuration` |
| Access control | `aws_cloudfront_origin_access_control`, `aws_s3_bucket_policy` |
| Public edge | `aws_cloudfront_distribution` |
| Identity | `aws_iam_role` (sync role), `aws_iam_role_policy` (its permissions) |

Plus 1 new data source (`aws_cloudfront_cache_policy.caching_optimized`) and 0 new
`terraform_remote_state` reads.

## Obligations carried forward

- **A follow-up on `crewsafe/web`'s container-image pipeline must be raised before this feature is
  considered landed** (FR-019, SC-006) — not optional, not implicit. Not yet raised as of this
  promotion; tracked as the one open item blocking "done."
- **SCRUM-271 must not invent a second sync mechanism.** It reads `web_bucket_name` and
  `web_sync_role_arn` from this component's outputs and extends the same `workflow_dispatch`
  pattern `.github/workflows/web-sync.yml` establishes.
- **Whoever eventually adds a custom domain to either distribution** inherits the same TLS-floor
  consequence SCRUM-176's runbook §10 already documents.

## Deferred, with the gap stated

A web application firewall; access logging from the distribution or the bucket (deliberate — see
runbook §6); a custom domain; automated sync-on-merge (SCRUM-271's scope); per-path CloudFront
invalidation instead of `/*`; retiring or repurposing `web-ci.yml`'s image pipeline (the required
follow-up, not this feature's decision).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| A second customer-managed apply policy (`CrewSafeComputeWebTerraformApply`) rather than one policy per component | The existing `CrewSafeComputeTerraformApply` had only ~1,646 non-whitespace characters of headroom left in its own 6,144-char budget — not enough to safely add S3, CloudFront, and IAM-role-management actions | Editing the existing policy in place was rejected: the arithmetic is tight enough to fail outright or leave zero margin, and it would force re-reviewing SCRUM-176's already-applied backend document. A role may carry up to ten managed policies. |

## Implementation Notes (added post-`/speckit-implement`)

The design held; several bugs surfaced only once real Terraform tooling (not just plan-time
reasoning) was run against the configuration. None changed the architecture — all were caught by
the test-first discipline the plan called for, exactly as intended:

1. **`data "aws_iam_policy_document"` for the bucket policy was wrong** — this file's own header
   comment already warned that `mock_provider "aws"` fabricates a random, invalid string for that
   data source's `.json` attribute. Fixed by switching to `jsonencode()` over literal HCL, matching
   the pattern already used for the sync role's policies. Caught immediately by `terraform test`.
2. **The sync role's S3 actions were originally split into two statements**, which would have made
   the policy three statements once the CloudFront statement was added — contradicting the
   two-statement design. Merged `ListBucket`/`GetObject`/`PutObject`/`DeleteObject` into one
   statement with a two-element `Resource` list (the bucket ARN plus its object prefix).
3. **A duplicated account-match precondition** was added to the new S3 bucket, mirroring the
   pattern on `aws_ecs_cluster.main` — but this component's convention is exactly one such guard,
   and the duplicate broke the pre-existing `rejects_mismatched_account` test's single-resource
   `expect_failures` assertion. Removed.
4. **Trivy flagged `AWS-0132` (HIGH)** — SSE-S3 without a customer-managed KMS key — a real CI-gate
   finding, not a lint nit. Resolved with `#trivy:ignore:AWS-0132`, mirroring
   `infra/terraform/bootstrap/state/main.tf`'s identical, already-accepted exemption for the same
   reason (avoiding a cross-service KMS dependency), with a stronger rationale specific to this
   bucket: its contents have no confidentiality need (spec SEC-003), only integrity/authenticity.
5. **A pre-existing FR-053 source-guard rule** ("no `aws_iam_role` resource — those belong to
   `secrets-shared-dev`") had never anticipated `compute-shared-dev` legitimately creating one.
   Narrowed from a blanket forbid to a targeted exception permitting only the `web_sync` role by
   name; any other `aws_iam_role` is still rejected.
6. **Two test-assertion bugs**: a reference to a non-existent top-level `viewer_protocol_policy`
   attribute (it only exists nested inside `default_cache_behavior`), and a type mismatch comparing
   `custom_error_response.response_code` (resolves as a number) against the string `"200"`. Both
   fixed; one assertion (`.web.arn != .main.arn`) was removed entirely as untestable under
   `mock_provider` — every instance of a mocked resource *type* shares the same default ARN, so the
   real hostname-distinctness guarantee is verified live (runbook §5), not in the mocked suite.
7. **A blanket `health_check {}` forbid rule was drafted and rejected before it shipped** — it
   would have false-positived against the backend's own existing, legitimate target-group health
   check. The `aws_lb_target_group`/`aws_ecs_service`/`aws_ecs_task_definition` count-invariant
   check (mirroring the file's existing `load_balancer_blocks` pattern) fully covers User Story 2's
   negative-capability requirement without touching that construct.
8. **Two `ripgrep` usage bugs** in the new `test-web-sync-workflow.sh` guard: `-E` is ripgrep's
   `--encoding` flag, not POSIX extended-regex (alternation works in rg's default regex with no
   flag at all); and `rg -n`'s line-number prefix broke a piped second-stage anchor (`^\s*...`)
   until `-n` was dropped from the first call. Both fixed; all 8 negative fixtures now correctly
   rejected.
9. **The IAM policy mechanism itself was wrong, and this one was not caught by the test-first
   discipline above — it was caught by the user, reviewing `infra/terraform/compute/iam/` in the
   IDE.** `/speckit-research` never surfaced `infra/terraform/iam-policy-management/` (SCRUM-265),
   which had already migrated *every* component's plan/apply permissions — `compute` included —
   from the hand-attached console policies SCRUM-176's runbook describes to Terraform-managed
   customer-managed policies rendered from `policies/<component>/{plan,apply}.json.tftpl`. This
   feature's original Phase 6 (extending `infra/terraform/compute/iam/plan-role-policy.json` in
   place and hand-authoring a new `web-apply-role-policy.json`) edited files that turned out to be
   vestigial — "compatibility inputs for their existing source guards" per SCRUM-265's own runbook,
   not the live attachment mechanism. **Corrected**: those edits were reverted; the new grants
   instead landed as a new sibling component, `compute-web`, registered in
   `iam-policy-management/main.tf`'s `local.components` list (14 → 16 bindings), with its own
   `policies/compute-web/{plan,apply}.json.tftpl` templates and a new negative-boundary test in
   that root's own `tftest.hcl`, per its runbook's explicit "Policy changes" process. This also
   **resolved** the original research.md R-010 "second apply policy, tight budget" concern more
   cleanly than planned — under SCRUM-265, every policy is already independently customer-managed
   (no shared 10,240-char inline budget the plan-role side would have contended for), so a sibling
   component was simply the natural shape, not a budget-driven workaround.

All 8 planted violations from the quickstart's guard-bite table were confirmed caught by hand
(6 via the shell source guard, 1 via a `terraform test` assertion, 1 more via the shell guard's
`aws_lb_listener_rule` check) and reverted cleanly. Final state: 22/22 `terraform test` runs pass
in `compute-shared-dev`, 3/3 in `iam-policy-management`, 44/44 source-guard checks pass, 38/38
`test-web-sync-workflow.sh` checks pass, 0 HIGH/CRITICAL Trivy findings, `terraform fmt`/`validate`
clean in both roots, `actionlint` clean.

**Not yet done as of this promotion**: the post-merge operational sequence — now a **two-step**
apply (`iam-policy-management-shared-dev` first, so the grants exist; then `compute-shared-dev`),
the initial sync, and raising the FR-019 follow-up — all of it requires real AWS/GitHub access this
working session does not have, and is
the next owner's job per the runbook.
