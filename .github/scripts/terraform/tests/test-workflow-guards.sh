#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/helpers/test-helpers.sh"

selector="$ROOT/.github/scripts/terraform/select-execution-role.sh"
normal_plan_role="arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformPlanRole"
normal_apply_role="arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformApplyRole"
policy_plan_role="arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformIamPolicyPlanRole"
policy_apply_role="arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformIamPolicyApplyRole"

[[ "$($selector cognito-shared-dev plan standard "$normal_plan_role" "$normal_apply_role" "$policy_plan_role" "$policy_apply_role")" == "$normal_plan_role" ]] ||
  fail "standard component did not select the normal plan role"
[[ "$($selector iam-policy-management-shared-dev apply policy-management "$normal_plan_role" "$normal_apply_role" "$policy_plan_role" "$policy_apply_role")" == "$policy_apply_role" ]] ||
  fail "IAM policy-management component did not select its dedicated apply role"
if "$selector" iam-policy-management-shared-dev plan standard "$normal_plan_role" "$normal_apply_role" "$policy_plan_role" "$policy_apply_role" >/dev/null 2>&1; then
  fail "IAM policy-management component accepted the standard execution-role family"
fi
if "$selector" cognito-shared-dev plan policy-management "$normal_plan_role" "$normal_apply_role" "$policy_plan_role" "$policy_apply_role" >/dev/null 2>&1; then
  fail "standard component accepted the policy-management execution-role family"
fi

for workflow in terraform-validate.yml terraform-plan.yml terraform-apply.yml; do
  assert_file ".github/workflows/$workflow"
done
[[ "$(find "$ROOT/.github/workflows" -maxdepth 1 -name 'terraform-*.yml' | wc -l | tr -d ' ')" == 3 ]]
assert_contains ".github/workflows/terraform-validate.yml" '"infra/terraform/**"'
assert_not_contains ".github/workflows/terraform-validate.yml" '"docs/**"'
assert_contains ".github/workflows/terraform-plan.yml" "github.ref == 'refs/heads/main'"
assert_contains ".github/workflows/terraform-apply.yml" "github.ref == 'refs/heads/main'"
# GitHub expression syntax must remain literal in these assertions.
# shellcheck disable=SC2016
assert_contains ".github/workflows/terraform-plan.yml" 'terraform-${{ inputs.target_account_alias }}-${{ inputs.terraform_component }}'
# shellcheck disable=SC2016
assert_contains ".github/workflows/terraform-apply.yml" 'terraform-${{ inputs.target_account_alias }}-${{ inputs.terraform_component }}'
assert_contains ".github/workflows/terraform-plan.yml" "select-execution-role.sh"
assert_contains ".github/workflows/terraform-apply.yml" "select-execution-role.sh"
assert_contains ".github/workflows/terraform-plan.yml" "preflight-iam-policy-account.sh"
assert_contains ".github/workflows/terraform-apply.yml" "preflight-iam-policy-account.sh"
assert_contains ".github/workflows/terraform-plan.yml" "iam_policy_plan_role_arn"
assert_contains ".github/workflows/terraform-apply.yml" "iam_policy_apply_role_arn"
assert_contains ".github/scripts/terraform/preflight-iam-policy-account.sh" "terraform -chdir=\"\$tf_root\" state list"
assert_contains ".github/scripts/terraform/preflight-iam-policy-account.sh" "NoSuchEntity"
assert_not_contains ".github/scripts/terraform/preflight-iam-policy-account.sh" "terraform import"
assert_not_contains ".github/scripts/terraform/preflight-iam-policy-account.sh" "detach-role-policy"
assert_not_contains ".github/scripts/terraform/preflight-iam-policy-account.sh" "delete-policy"
assert_contains ".github/workflows/terraform-validate.yml" 'terraform-provider-lock-cognito'
assert_contains ".github/workflows/terraform-validate.yml" 'terraform providers lock'
assert_contains ".github/workflows/terraform-validate.yml" 'Do not execute Terraform locally.'
assert_contains ".github/workflows/terraform-validate.yml" 'needs: lockfiles'
