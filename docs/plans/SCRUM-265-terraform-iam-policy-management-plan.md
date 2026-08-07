# SCRUM-265 — Terraform-managed IAM policy management plan

## Outcome

The `iam-policy-management-shared-dev` Terraform component owns the six non-bootstrap
module policy sets in a new AWS account. It creates twelve customer-managed IAM policies
and twelve explicit role-policy attachments:

```text
{cognito, compute, database, ecr, network, secrets} × {plan, apply}
```

The normal Terraform plan/apply roles, their trust policies, the GitHub OIDC provider,
and the externally bootstrapped policy-management execution roles remain outside this
Terraform root.

## Ownership and naming

The root is `infra/terraform/iam-policy-management/` with remote state key
`crewsafe/iam-policy-management/shared-dev.tfstate`. Every policy uses the exact path
`/crewsafe/terraform/iam-policy-management/` and the name
`crewsafe-terraform-<component>-<role_kind>-policy`.

Each policy is attached explicitly with `aws_iam_role_policy_attachment` to exactly one
of the existing roles:

| Binding | Target role |
| --- | --- |
| `<component>-plan` | `CrewSafeGitHubTerraformPlanRole` |
| `<component>-apply` | `CrewSafeGitHubTerraformApplyRole` |

The root has no `aws_iam_role`, inline-policy, OIDC-provider, or account-wide exclusive
attachment resource. `prevent_destroy = true` and the catalogue `allow_destroy = false`
protect the first-account policy set from accidental deletion.

## Execution-role separation

The account registry may contain these optional, exact keys for this component only:

- `iam_policy_plan_role_arn` → `CrewSafeGitHubTerraformIamPolicyPlanRole`
- `iam_policy_apply_role_arn` → `CrewSafeGitHubTerraformIamPolicyApplyRole`

The workflow selector refuses missing or malformed dedicated ARNs and never falls back to
the normal roles for the IAM component. All other components continue to use the normal
Terraform roles. The dedicated roles are externally bootstrapped with trust restricted to
the reviewed repository `main` OIDC subject and the `sts.amazonaws.com` audience.

The externally reviewed permission boundary is deliberately narrow:

- plan roles: read-only IAM inspection needed to refresh policy and attachment state;
- the dedicated apply role: create/update/version/tag the twelve policies and attach them
  to the two exact existing Terraform role names, plus the corresponding read actions;
- both dedicated roles also receive the minimum existing remote-state bucket access for
  this component's state key: plan can read state and manage its native lock object, and
  apply can read/write only the selected account's `crewsafe/*` state objects;
- no role creation, trust-policy update, OIDC-provider mutation, inline-policy mutation,
  unrestricted `iam:*`, or normal-role self-escalation.

The exact external role policy is an account-bootstrap artifact, not a Terraform resource
in this repository. Review evidence must show the action/resource allowlist and denied
operations before the first apply.

## CI flow

Plan and apply remain dispatchable only from `main`, use the existing remote-backend and
reviewed-plan metadata controls, verify the caller account, and publish non-secret counts,
names, ARNs, target roles, run IDs, and convergence evidence. Full policy documents,
credentials, tokens, and state contents are not emitted as workflow evidence.

For the IAM component, CI performs a fresh-account preflight before Terraform mutation:

1. Verify the normal bootstrap roles exist in the selected account.
2. Check all twelve exact policy names and attachments.
3. Fail closed on an unexpected existing object; no import, adoption, overwrite, detach,
   delete, or old-account migration is performed.
4. Permit an already-existing object only when its exact Terraform resource address is
   already present in the reviewed remote state, which supports recovery from a partial
   apply.

After first provisioning, a new reviewed plan must converge with no unexpected changes.
The plan/apply role pair and the policy-management role pair are passed through the closed
account registry; arbitrary role inputs are not accepted.

## Managed-policy version boundary

AWS managed policies have a finite version limit. If a policy reaches that limit, the
workflow pauses and records the failure. An operator must remove only a reviewed,
non-default obsolete version through the approved account-bootstrap procedure, preserve
the default version, and generate a new reviewed plan. The Terraform root never deletes a
default version as an automated recovery step.

## Verification evidence

The implementation adds catalog, account-registry, role-selection, source-boundary,
collision, policy-document, and Terraform contract tests. CI must run Terraform format,
validate, and test checks for the new root together with the existing repository guards.
Terraform and AWS operations are CI-only; no local state, plan, AWS profile, or apply is
permitted.
