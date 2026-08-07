# SCRUM-265 — IAM policy-management runbook

This component provisions the reviewed custom IAM policies required by the six CrewSafe
Terraform modules in a new AWS account. It is CI-only. Do not run Terraform locally, use a
local AWS profile, download remote state, or save a plan on a workstation.

## Before the first plan

The account must already contain the GitHub OIDC provider, the normal Terraform roles,
and the externally bootstrapped policy-management roles. The copyable bootstrap artifacts
are in [`infra/terraform/iam-policy-management/bootstrap/`](../../infra/terraform/iam-policy-management/bootstrap/):
render `trust-policy.json.tftpl`, `plan-role-policy.json.tftpl`, and
`apply-role-policy.json.tftpl` with the selected account ID and exact
`CREWSAFE_GITHUB_OIDC_MAIN_SUBJECT`, then follow the installation commands in its
`README.md`. These are standalone customer-managed permission policies attached to the
dedicated roles, not inline policies.

Confirm the registry entry has all four exact role ARNs for the selected account:

```json
{
  "plan_role_arn": "arn:aws:iam::<account-id>:role/CrewSafeGitHubTerraformPlanRole",
  "apply_role_arn": "arn:aws:iam::<account-id>:role/CrewSafeGitHubTerraformApplyRole",
  "iam_policy_plan_role_arn": "arn:aws:iam::<account-id>:role/CrewSafeGitHubTerraformIamPolicyPlanRole",
  "iam_policy_apply_role_arn": "arn:aws:iam::<account-id>:role/CrewSafeGitHubTerraformIamPolicyApplyRole"
}
```

The dedicated role trust must be limited to the reviewed repository `main` OIDC subject
and the `sts.amazonaws.com` audience. Its reviewed permissions must allow only the policy
read/create/version/tag operations and exact role attachments required by this component.
It must deny role creation, trust changes, OIDC changes, inline policy mutation,
unrestricted `iam:*`, and access to unrelated role targets.

The dedicated roles also need the existing least-privilege remote-state permissions for
`crewsafe/iam-policy-management/shared-dev.tfstate`: plan needs state reads and native
lock-object management, while apply needs the corresponding state-object write access.
Scope these S3 permissions to the selected account's CrewSafe state bucket and
`crewsafe/*` object prefix; the bucket-level `s3:ListBucket` grant is required by the
existing `HeadBucket` backend inspection and does not grant object read or write access.
Do not grant a new account-wide backend role.

The expected first-account state is that all twelve policies and their twelve attachments
are absent. Existing objects are not migrated or imported by this change.

## First provisioning

1. Merge the reviewed change to `main` and dispatch **Terraform Plan** with the registered
   account alias (for example, `dev`), component `iam-policy-management-shared-dev`, and
   operation `apply`.
2. Confirm the run selects `CrewSafeGitHubTerraformIamPolicyPlanRole`, verifies the caller
   account, and reports twelve policies and twelve attachments under
   `/crewsafe/terraform/iam-policy-management/`.
3. Review the plan for exactly twelve `aws_iam_policy` resources and twelve
   `aws_iam_role_policy_attachment` resources. There must be no role, trust, OIDC,
   inline-policy, or unrelated component-state changes.
4. If preflight reports a collision, missing role, wrong account, invalid policy document,
   or insufficient permission, stop. Repair the external bootstrap or source and create a
   new plan; do not import, overwrite, detach, delete, or bypass the guard.
5. Dispatch **Terraform Apply** with the exact successful plan run ID and attempt. Enter
   the required typed confirmation. The apply must select
   `CrewSafeGitHubTerraformIamPolicyApplyRole` and verify the account again.
6. Dispatch a fresh plan after apply. Record the no-change convergence result with the
   plan/apply run IDs, commit, policy names/ARNs, target roles, and attachment count in
   the Jira/PR evidence.

## Policy changes

Change only the central template under
`infra/terraform/iam-policy-management/policies/<component>/`. Add or update a negative
boundary test before changing the template. Use the normal PR review, merge to `main`,
then repeat the reviewed plan/apply flow. The old per-component JSON files remain
compatibility inputs for their existing source guards; the central Terraform root is the
authoritative managed-policy source for SCRUM-265.

## Failure and recovery

| Condition | Required response |
| --- | --- |
| Missing normal or dedicated bootstrap role | Stop and repair external bootstrap; never create a replacement from a normal role. |
| Unexpected policy collision | Resolve it through account bootstrap and generate a new plan; no implicit import/adoption. |
| Unexpected attachment or target role | Stop; do not detach or attach to a different role. |
| Partial apply | Keep remote state intact and generate a fresh reviewed plan. Objects already tracked in state may converge; untracked collisions remain blocked. |
| Managed-policy version limit | Remove only a reviewed non-default obsolete version through the approved bootstrap procedure, preserve the default version, then generate a new plan. |
| Wrong account, stale plan, reused plan, or wrong commit | Reject the run and generate a fresh reviewed plan. |
| Unauthorized/transient AWS error | Preserve CI evidence, correct the cause, and retry only with a new reviewed plan if the plan is no longer valid. |

Never edit Terraform state manually, delete the default managed-policy version, recreate
bootstrap identities, or run a local apply.

## CI journey state labels

Use these explicit labels in run summaries, Jira comments, and PR evidence so operators
can distinguish an empty account from an incomplete or denied run:

- **Loading** — CI is resolving the catalog, account registry, backend, and execution role.
- **Empty** — fresh-account preflight found no declared policies or attachments.
- **Success** — the reviewed apply completed and reports twelve policies and attachments.
- **Validation** — policy, account, role, plan, or collision checks are running.
- **Stale** — the reviewed plan is from the wrong commit, run attempt, or state revision.
- **Denied** — authorization, role separation, or policy scope rejected the operation.
- **Offline** — AWS or CI service access is unavailable; no local fallback is permitted.
- **Error** — a mutation or verification failed and requires a fresh reviewed plan.

## Verification checklist

- [ ] CI catalog, resolver, workflow, source-boundary, and fixture tests pass.
- [ ] Terraform format/validate/test checks pass in CI.
- [ ] Twelve policy names and twelve attachment keys are present.
- [ ] Every policy uses the exact path and one of the two normal role targets.
- [ ] No bootstrap role, trust policy, OIDC provider, inline policy, or unrelated state
      resource changed.
- [ ] The fresh post-apply plan is no-change.
- [ ] Evidence contains counts, names/ARNs, roles, run IDs, and outcomes only; it contains
      no credentials, tokens, state contents, or full secret data.
