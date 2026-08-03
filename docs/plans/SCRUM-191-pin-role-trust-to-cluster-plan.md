# SCRUM-191 — Harden task and execution role trust against the confused deputy

**Jira**: [SCRUM-191](https://u-team-h6ii4x03.atlassian.net/browse/SCRUM-191) · Subtask of SCRUM-142
· Relates to SCRUM-174, SCRUM-176

**Component**: `secrets-shared-dev` (`infra/terraform/secrets`)

**Status**: Implemented, pending apply

> **The issue title and the branch name say "pin role trust to the compute cluster". That is not
> what was built, because it is not possible.** The names are kept so the Jira key, branch, and
> commits stay traceable. This document records why, because it is the durable copy — the Spec Kit
> artifacts under `specs/` are gitignored and will not survive the branch.

## What the issue asked for

SCRUM-174 deferred a trust-policy hardening with a comment in its own source: a "production-grade
hardening would add an `aws:SourceArn` condition pinning this to a specific ECS cluster", once a
cluster existed. SCRUM-176 built the cluster and published `cluster_arn` specifically so this
follow-up could consume it. That design was approved at SCRUM-176's plan review (research item
R-009), which weighed three options and chose it over a dormant variable and over dropping the
requirement.

The stated exposure: both roles are assumable by the `ecs-tasks.amazonaws.com` service principal
**account-wide**, so any task in a second cluster could assume the identities that read the database
master credential and the weather API key.

## What was found

**AWS does not support scoping an ECS trust policy to a cluster.** From the
[ECS task IAM role documentation](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html),
verbatim:

> Using the `aws:SourceArn` condition key to specify a specific cluster is not currently supported,
> you should use the wildcard to specify all clusters.

The documented condition is account-and-region scoped, pairing `ArnLike` on `aws:SourceArn` with
`StringEquals` on `aws:SourceAccount`.

Three consequences reshaped the work:

1. **The threat `aws:SourceArn` addresses is not the threat the issue describes.** These keys are
   populated only when a service acts on behalf of a resource owner, so they close a *cross-account*
   confused deputy. The *same-account, second-cluster* exposure the issue is written about is not
   addressable by any trust policy.
2. **`cluster_arn` has no consumer.** The condition needs a region and an account, both already held
   as `var.aws_region` and `var.expected_account_id`. The planned remote-state read from `secrets`
   to `compute`, the reversed dependency direction, and the apply-ordering constraint all
   disappeared — the change is simpler than the approved design, not more complex.
3. **The posture had to be restated, not just tightened.** Two runbooks told operators a cluster pin
   was coming.

## What was built

One `Condition` block on the trust policy shared by `aws_iam_role.task_execution` and
`aws_iam_role.task`:

```hcl
Condition = {
  ArnLike      = { "aws:SourceArn" = local.ecs_source_arn_pattern }   # arn:aws:ecs:<region>:<account>:*
  StringEquals = { "aws:SourceAccount" = var.expected_account_id }
}
```

| File | Change |
| --- | --- |
| `infra/terraform/secrets/main.tf` | `local.ecs_source_arn_pattern`; the `Condition` block; the deferral comment replaced with the reasoning above |
| `infra/terraform/secrets/tests/secrets.tftest.hcl` | Four per-role, per-key assertions plus one forbidding `…IfExists` |
| `docs/runbooks/SCRUM-174-secrets-and-iam.md` | New section 12: posture, residual risk, procedure, verification, diagnosis, revert |
| `docs/runbooks/SCRUM-176-backend-compute-runtime.md` | Section 10's interim warning replaced; Trivy exemptions preserved |
| `infra/terraform/compute/outputs.tf` | `cluster_arn` description corrected — description text only |

No grant, output, variable, IAM policy document, workflow, catalogue entry, or source guard changed.

## Threat coverage, stated honestly

| Threat | Status |
| --- | --- |
| Another account's ECS service principal induced to assume these roles | **Closed** |
| A second ECS cluster **in this account** assumes these roles | **Open, accepted.** No trust policy can prevent it |
| What the roles may read once assumed | Unchanged |

**This is a smaller security win than SCRUM-191 promised.** The open row's only real mitigation is a
process obligation: whoever creates a second cluster in this account must give its tasks their own
identities. It is recorded in the SCRUM-174 runbook because nothing in code can enforce it. The
exposure is bounded today — one cluster, and Terraform is CI-only.

## Decisions worth disagreeing with

Three were taken deliberately and a reviewer may reasonably reject any of them.

### 1. No ADR

Recommended, and declined. The rationale accepted: this records a corrected fact about what AWS
supports, not a choice between viable alternatives, so an ADR's central artifact — the rejected
alternative and why — would be empty. **The consequence is that the runbooks and the source comment
carry the entire record**, held to a reconstruction standard: a reader with only this repository must
be able to determine what was approved, why it is not buildable, what was built instead, and what
risk remains.

### 2. The apply is not staged

The safer sequence — apply the task role's condition, verify, then the execution role's — is not
expressible. Both `terraform-plan.yml` and `terraform-apply.yml` are gated to the `main` ref, neither
accepts a free-form variable at dispatch, and the apply replays one saved plan for the whole
component root. Staging would need a workflow change or a second pull request merged after the first
is applied.

Three resolutions were weighed:

| | Design | Cost |
| --- | --- | --- |
| **A — chosen** | One apply, with a revert commit **authored and reviewed before dispatch** | Loses per-role attribution if it fails |
| B | Two stacked pull requests | Splits one security decision across two reviews |
| C | `…IfExists` operators on the execution role | Removes the risk *and* the ability to verify the control |

C was rejected because `ArnLikeIfExists` evaluates true when the key is absent: a healthy task would
prove nothing, and the execution role could silently keep its old posture with every test green. A
control that cannot be distinguished from its own absence is close to no control. The test suite now
asserts the `…IfExists` forms stay absent.

### 3. The risk this leaves

AWS documents these conditions only for the **task** role; the execution role's documented trust
policy carries none, and whether ECS populates the keys when it assumes the execution role is not
documented either way. **A condition on an absent key fails closed.** If it does, tasks stop starting.

Mitigations: the pre-written revert, and verification by a *newly started* task rather than by the
apply succeeding — IAM accepts any valid trust policy, and a running task keeps its vended session,
so both cheap signals are false negatives.

## Test evidence

Assertions were written before the condition existed and observed failing (4 assertion failures, no
other errors). A mutation harness then broke each control in turn:

| Mutation | Result |
| --- | --- |
| Execution role loses `ArnLike` | Fails, naming the execution role and `aws:SourceArn` |
| Task role loses `ArnLike` | Fails, naming the task role |
| Either role loses `StringEquals` | Fails, naming that role and `aws:SourceAccount` |
| Pattern names account `999999999999` | Fails on both roles |
| `ArnLikeIfExists` substituted | Fails on the `…IfExists` prohibition |

**The wrong-account mutation caught a real defect.** The first draft compared the policy against
`local.ecs_source_arn_pattern`, so changing the local changed both the policy and the expectation —
the assertion passed against any value, including a wrong account. It now rebuilds the expected ARN
from the test's own variables. This is exactly the vacuous-assertion failure the mutation step exists
to catch, and it would not have been visible from a green suite.

`terraform test` passes 12/12 offline. Source guards, catalogue test, `fmt`, and `validate` pass
unchanged. `trivy config --severity CRITICAL,HIGH` reports 0 findings across `infra/terraform/`.

> Local runs used Terraform **1.15.8**; CI pins **1.10.5**. The test file notes that override
> behaviour differs across that range, so **CI's run is the authority**, not the local one.

## Applying it

See section 12 of the [SCRUM-174 runbook](../runbooks/SCRUM-174-secrets-and-iam.md) for the
procedure, the plan checks that abort the dispatch, verification, and the revert. In outline:

1. Author and review the revert commit **before** dispatching.
2. Record the healthy task count and both role ARNs.
3. Plan — must show `0 to add, 2 to change, 0 to destroy`. Abort on any replacement.
4. Apply.
5. Force a new deployment and confirm the new task reaches healthy. Confirm both role ARNs are
   unchanged.

## Constitution compliance

All six gates pass. One recorded exception: no ADR (decision 1 above), documented in the Spec Kit
plan's Complexity Tracking with rationale, rejected alternative, and reviewer approval — the
mechanism Development Workflow §2 provides. Tests precede implementation and were observed failing
(Principle III). Security-sensitive behaviour has negative tests (Principle II). No credential enters
source, state, or logs.
