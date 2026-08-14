# SCRUM-371 — ECS Exec Access to Shared-Dev RDS

**Jira**: [SCRUM-371](https://u-team-h6ii4x03.atlassian.net/browse/SCRUM-371) · **Components**:
`secrets-shared-dev`, `compute-shared-dev` (no new component) · **Runbook**:
[SCRUM-371-ecs-exec-rds-access.md](../runbooks/SCRUM-371-ecs-exec-rds-access.md)

## Summary

Turns the already-running backend ECS task into a developer's tunnel to the private shared-dev
RDS instance, instead of adding a bastion or a second IAM identity. Two existing components
change in place: `secrets` (the task role gains the `ssmmessages` channel actions its ECS Exec
sidecar needs to host a session) and `compute` (`enable_execute_command = true` on the service,
plus one new, narrow IAM grant attached to the existing `crewsafe-developers` group from
SCRUM-372 — `ecs:ExecuteCommand`, `ssm:StartSession`, `secretsmanager:GetSecretValue`, each
scoped, no restatement of what `ViewOnlyAccess` already covers).

No new Terraform component, no new IAM identity, no security-group or `publicly_accessible`
change.

## Key decisions

- **The developer-group grant lives in `compute`, not `secrets`.** `compute` already owns the
  ECS cluster/task ARNs the grant must scope to, and already reads four other components'
  remote state — adding a fifth (`developer-access`) extends an established pattern.
- **A genuine, pre-implementation-caught CI-permission gap.** `compute`'s plan/apply CI roles
  held zero `iam:*GroupPolicy` actions before this feature. Found by reading the live
  `iam-policy-management` templates directly during planning, not discovered as a live
  `AccessDenied` mid-apply — fixed in both the authoritative templates and the compatibility
  `compute/iam/*.json` files the source guard still checks.
- **`secrets.tftest.hcl`'s wildcard invariant generalized, test-first.** The existing test
  asserted exactly one `Resource: "*"` statement (`ecr:GetAuthorizationToken`). This feature's
  required `ssmmessages` statement is a second, necessary wildcard (AWS accepts no narrower
  scope for those four actions) — the test was updated to a named, closed two-item allow-list
  before the production change landed, not loosened to an open-ended relaxation.

## Implementation-time corrections — found by live testing, not assumed in advance

Two more, past what pre-implementation research anticipated. Both are the kind of thing
`research.md` R-005 explicitly flagged as an open verification item ("confirm during
implementation and validate by the live end-to-end test... if the exact session-target ARN shape
has changed, the negative test... or the positive live test... would surface it") — this is that
flag paying off, not a defect in the plan.

1. **`ssm:StartSession` needs the SSM document ARN granted too, not just the ECS task.** The
   first live port-forward attempt failed with an explicit `AccessDeniedException` naming
   `document/AWS-StartPortForwardingSessionToRemoteHost` as a missing resource — AWS authorizes
   this session type against **both** the task target and the document. `ecs:ExecuteCommand` has
   no such dependency. Fixed by splitting the combined statement into two:
   `ExecIntoBackendTask` (`ecs:ExecuteCommand`, task ARN only) and `StartSessionToBackendTask`
   (`ssm:StartSession`, task ARN **and** document ARN).
2. **The document name itself had a typo.** `AWS-StartPortForwardingToRemoteHost` does not
   exist; the real AWS-owned document is `AWS-StartPortForwardingSessionToRemoteHost`
   ("Session" included). Caught by the next live retry (`InvalidDocument`), confirmed against
   AWS documentation, corrected everywhere the name appeared (grant, test assertions, design
   docs, runbook).
3. **An already-running task doesn't retroactively pick up a task-role permission its Exec
   sidecar needed at connect time.** After the `ssmmessages` grant (`secrets`) was applied, the
   task that had been running since before that grant existed still reported
   `TargetNotConnected` — its Exec agent had already tried and failed to open its control
   channel and doesn't self-heal. Fixed operationally, not by a further Terraform change: a
   `Backend CI` `redeploy` dispatch (`--force-new-deployment`, existing image, no rebuild) starts
   a fresh task under the corrected permissions. Documented in the runbook's troubleshooting
   table so it isn't rediscovered from scratch next time.

All three corrections shipped as their own small, reviewed, test-first PRs (#249, #250) after the
original #248 — each following the same generalize-test-first-then-fix discipline as the
original implementation, not a shortcut taken under live-debugging pressure.

## Testing approach

Native `terraform test`, `mock_provider "aws" {}`, the group policy built with `jsonencode()`
over a `local` — never `data "aws_iam_policy_document"` (reuses `037`'s R-009 finding: a mocked
provider fabricates a data source's `.json` attribute, so testing it tests invented data). The
one property a mock cannot prove — real IAM authorization — was proven live instead: a positive
end-to-end tunnel-and-`psql` test (T019) using the `zctiong-iss` SCRUM-372 identity plus this
feature's grant. The planned negative test (an identity holding only `ViewOnlyAccess`, T020) and
the independent second-developer runbook walkthrough (T025/T026) were explicitly waived by the
user for this cycle — the `terraform test` assertions still prove the grant's shape is scoped and
additive-only, and the runbook is written directly from commands proven to work in T019, just not
independently field-tested by an unaided second party.

## Constitution Check

**PASS**, both pre-research and post-design gates. No violations; Complexity Tracking is empty.
See `specs/038-ecs-exec-rds-access/plan.md` for the full gate table.

## Full detail

`specs/038-ecs-exec-rds-access/` holds the complete spec, research (7 decisions plus the two
live-tested amendments to R-005), data model, contracts, and quickstart. Task-by-task build order
is in `tasks.md` (31 tasks across setup, foundational, three user stories, and polish).
