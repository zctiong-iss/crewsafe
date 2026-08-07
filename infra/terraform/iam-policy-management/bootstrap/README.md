# SCRUM-265 policy-management role bootstrap

These are account-bootstrap artifacts for the two GitHub OIDC roles that execute
`infra/terraform/iam-policy-management`. They are deliberately outside Terraform state:
the IAM policy-management root must not create or modify the identity it needs in order to
run.

The templates assume the CrewSafe state backend is already provisioned by SCRUM-155 in
`ap-southeast-1`. Replace `<ACCOUNT_ID>` with the target account ID and
`<GITHUB_OIDC_MAIN_SUBJECT>` with the exact value of the repository variable
`CREWSAFE_GITHUB_OIDC_MAIN_SUBJECT`. Do not replace placeholders with a wildcard.

## 1. Validate the templates

Render each template, then validate the rendered documents before using them. The trust
document must contain the account's `token.actions.githubusercontent.com` provider, the
`sts.amazonaws.com` audience, and the exact immutable repository `main` subject. The plan
and apply documents must be valid IAM policy JSON.

## 2. Create the roles

Use an account administrator during fresh-account onboarding. Do not use either normal
Terraform role to bootstrap these identities.

```bash
aws iam create-role \
  --role-name CrewSafeGitHubTerraformIamPolicyPlanRole \
  --max-session-duration 3600 \
  --assume-role-policy-document file://trust-policy.json

aws iam create-role \
  --role-name CrewSafeGitHubTerraformIamPolicyApplyRole \
  --max-session-duration 3600 \
  --assume-role-policy-document file://trust-policy.json
```

## 3. Create and attach the customer-managed permission policies

These are standalone customer-managed policies, not inline role policies. Use the exact
path and names below:

| Role | Policy name | Source |
| --- | --- | --- |
| `CrewSafeGitHubTerraformIamPolicyPlanRole` | `CrewSafeGitHubTerraformIamPolicyPlan` | `plan-role-policy.json` |
| `CrewSafeGitHubTerraformIamPolicyApplyRole` | `CrewSafeGitHubTerraformIamPolicyApply` | `apply-role-policy.json` |

```bash
aws iam create-policy \
  --path /crewsafe/terraform/bootstrap/ \
  --policy-name CrewSafeGitHubTerraformIamPolicyPlan \
  --policy-document file://plan-role-policy.json

aws iam create-policy \
  --path /crewsafe/terraform/bootstrap/ \
  --policy-name CrewSafeGitHubTerraformIamPolicyApply \
  --policy-document file://apply-role-policy.json

aws iam attach-role-policy \
  --role-name CrewSafeGitHubTerraformIamPolicyPlanRole \
  --policy-arn arn:aws:iam::<ACCOUNT_ID>:policy/crewsafe/terraform/bootstrap/CrewSafeGitHubTerraformIamPolicyPlan

aws iam attach-role-policy \
  --role-name CrewSafeGitHubTerraformIamPolicyApplyRole \
  --policy-arn arn:aws:iam::<ACCOUNT_ID>:policy/crewsafe/terraform/bootstrap/CrewSafeGitHubTerraformIamPolicyApply
```

Review the rendered policy in IAM Policy Simulator or an equivalent account-admin review
before attaching it. The apply policy can manage only the declared SCRUM-265 policy path
and attachments to the two exact normal Terraform role names. Both policies explicitly
deny role, trust, OIDC-provider, and inline-policy mutation. The bucket-level
`s3:ListBucket` permission is intentionally required by the existing `HeadBucket` backend
inspection; all state and applied-plan object access remains key-scoped.

## 4. Register the role ARNs

Add these exact fields to the selected entry in the repository variable
`CREWSAFE_AWS_ACCOUNTS_JSON`:

```json
{
  "iam_policy_plan_role_arn": "arn:aws:iam::<ACCOUNT_ID>:role/CrewSafeGitHubTerraformIamPolicyPlanRole",
  "iam_policy_apply_role_arn": "arn:aws:iam::<ACCOUNT_ID>:role/CrewSafeGitHubTerraformIamPolicyApplyRole"
}
```

Only after the role trust, permission policies, and registry entry are verified should an
operator dispatch **Terraform Plan** for `iam-policy-management-shared-dev` from `main`.
