# SCRUM-372 — Developer Read-Only IAM Console Access

**Jira**: [SCRUM-372](https://u-team-h6ii4x03.atlassian.net/browse/SCRUM-372) · **Component**:
`developer-access-shared-dev` · **Runbook**:
[SCRUM-372-developer-readonly-iam-users.md](../runbooks/SCRUM-372-developer-readonly-iam-users.md)

## Summary

A sixth `standard`-family Terraform component, `developer-access-shared-dev`: one IAM group
(`crewsafe-developers`) carrying a scoped read-only policy, and one IAM user per current
developer — each with console (password) login and a CLI access key, both under a single group
membership. Replaces routine root-user access with individually attributable, least-privilege
identities, and gives SCRUM-371 (ECS Exec for RDS troubleshooting) a base identity set to attach
its own narrower permissions onto.

`2 + 4N` resources for `N` developers. No module abstraction, no new AWS account, no IAM
Identity Center, no MFA (all deliberate — see Clarifications in
`specs/037-developer-readonly-iam-users/spec.md`).

## Account model — a deliberate, disclosed deviation

Unlike every other component in this repository, this one targets **one shared AWS account**,
not a per-teammate isolated one. `AGENTS.md` §7 documents the isolated-account model as this
project's default; this feature deliberately deviates from it for the team's current working
setup. If the team wants the isolated model formalized long-term instead, that is worth its own
ADR — not a decision this component's implementation makes on the team's behalf.

## Key decisions

- **Reuse the shared `standard` execution-role family, not a dedicated one.** A third
  `execution_role_family` would require editing `resolve-component.sh`,
  `select-execution-role.sh`, and the catalog schema test — a workflow-file change this
  repository avoids for ordinary components. This component's real IAM-management power is
  instead contained by an **IAM path** (`/crewsafe/developers/` for users, a single fixed group
  ARN) that the apply role's hand-applied policy is scoped to — it can create/manage identities
  under that path and nowhere else in the account.
- **The developer roster is a committed file, not a dispatch input.**
  `developers.auto.tfvars` — reviewed through the same PR process as any other change, giving
  onboarding and offboarding a reviewable diff. This required a narrow `.gitignore` exception
  (the repo's blanket `*.tfvars` ignore otherwise silently drops it), added alongside the
  existing `!*.tfvars.example` carve-out with the same rationale: the file holds no secret,
  only usernames.
- **Console and CLI, both, for every developer.** Decided during `/speckit-clarify`: a single
  `aws_iam_user` per developer carries both a login profile and an access key, same read-only
  scope either way.
- **No MFA.** Also decided during clarify — explicitly out of scope for this ticket. The
  read-only policy's own narrow scope is the sole safeguard against a compromised credential.
- **No IAM permissions boundary.** Considered and rejected: a boundary would have to admit
  whatever SCRUM-371 layers on afterward (ECS Exec, one narrow `secretsmanager:GetSecretValue`
  grant), creating a coordination hazard where a too-tight boundary silently caps SCRUM-371's
  own additions. No other component in this repository uses one; the group policy's own
  explicit, tested allow-list is judged sufficient.
- **Passwords and access-key secrets necessarily live in Terraform state.** The one place in
  this repository where that's true — every other component only ever *references* a
  service-managed credential. Bounded by the same state-access control every component already
  relies on; the password half additionally self-neutralizes at first login (forced reset).

## Testing approach

Native `terraform test`, `mock_provider "aws" {}`, the read-only policy built with
`jsonencode()` over a `local` — never `data "aws_iam_policy_document"`, whose `.json` a mocked
provider would fabricate, making every downstream assertion meaningless (the same finding
`006-secrets-and-iam` made first). The acceptance test for "no write action anywhere" decodes
the actual attached policy and asserts every action is a subset of an explicit read-verb
allow-list — proven to actually catch a regression by a negative test that temporarily widens
the policy, observes the assertion fail, then reverts.

Onboarding and offboarding are tested as sequential `run` blocks sharing state within one test
file: apply a baseline roster, then apply a roster with one developer added (or removed), and
assert the new (or removed) developer's resources changed while every other developer's
identity is untouched. Native `terraform test` has no first-class "N resources in this plan"
assertion, so the proof is structural — resource presence, shape, and identity — rather than a
literal diff count; that existing `for_each` map entries are unaffected by adding or removing an
unrelated key is a structural guarantee of Terraform's addressing scheme, not something this
test suite needs to independently reprove.

## Constitution Check

**PASS**, both pre-research and post-design gates. No violations; Complexity Tracking is empty.
Three trade-offs are named explicitly rather than hidden (state-held credentials, no permissions
boundary, an unresolved apply-role character-budget question) — see
`specs/037-developer-readonly-iam-users/plan.md` for the full gate table and rationale.

## Implementation-time correction: IAM delivery mechanism

The plan above (and `research.md` R-001/R-007 as originally written) assumed hand-applied inline
CI-role policies, matching the older components. During implementation this was superseded:
`developer-access` is registered as a ninth component in the existing
`iam-policy-management-shared-dev` component (SCRUM-265), which manages customer-managed
policies and their role attachments entirely in Terraform. This eliminates the manual
console-attach step and the inline-policy character-budget risk outright (a customer-managed
policy has its own separate 6,144-character limit). See `research.md`'s amendments to R-001 and
R-007, and `docs/runbooks/SCRUM-372-developer-readonly-iam-users.md` §3 for the corrected
procedure.

## Full detail

`specs/037-developer-readonly-iam-users/` holds the complete spec, research, data model,
contracts, and quickstart. Task-by-task build order is in `tasks.md` (41 tasks across setup,
foundational harness, and three user stories: developer visibility, onboarding, offboarding).
