#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/helpers/test-helpers.sh"

selector="$ROOT/.github/scripts/terraform/select-execution-role.sh"
normal_plan_role="arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformPlanRole"
normal_apply_role="arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformApplyRole"
policy_plan_role="arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformIamPolicyPlanRole"
policy_apply_role="arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformIamPolicyApplyRole"
readonly VALIDATE_WORKFLOW='.github/workflows/terraform-validate.yml'
readonly PLAN_WORKFLOW='.github/workflows/terraform-plan.yml'
readonly APPLY_WORKFLOW='.github/workflows/terraform-apply.yml'
readonly PREFLIGHT_SCRIPT='.github/scripts/terraform/preflight-iam-policy-account.sh'

[[ "$(GITHUB_OUTPUT="" "$selector" cognito-shared-dev plan standard "$normal_plan_role" "$normal_apply_role" "$policy_plan_role" "$policy_apply_role")" == "$normal_plan_role" ]] ||
  fail "standard component did not select the normal plan role"
[[ "$(GITHUB_OUTPUT="" "$selector" iam-policy-management-shared-dev apply policy-management "$normal_plan_role" "$normal_apply_role" "$policy_plan_role" "$policy_apply_role")" == "$policy_apply_role" ]] ||
  fail "IAM policy-management component did not select its dedicated apply role"
if GITHUB_OUTPUT="" "$selector" iam-policy-management-shared-dev plan standard "$normal_plan_role" "$normal_apply_role" "$policy_plan_role" "$policy_apply_role" >/dev/null 2>&1; then
  fail "IAM policy-management component accepted the standard execution-role family"
fi
if GITHUB_OUTPUT="" "$selector" cognito-shared-dev plan policy-management "$normal_plan_role" "$normal_apply_role" "$policy_plan_role" "$policy_apply_role" >/dev/null 2>&1; then
  fail "standard component accepted the policy-management execution-role family"
fi

for workflow in terraform-validate.yml terraform-plan.yml terraform-apply.yml; do
  assert_file ".github/workflows/$workflow"
done
[[ "$(find "$ROOT/.github/workflows" -maxdepth 1 -name 'terraform-*.yml' | wc -l | tr -d ' ')" == 3 ]]
assert_contains "$VALIDATE_WORKFLOW" '"infra/terraform/**"'
assert_not_contains "$VALIDATE_WORKFLOW" '"docs/**"'
assert_contains "$PLAN_WORKFLOW" "github.ref == 'refs/heads/main'"
assert_contains "$APPLY_WORKFLOW" "github.ref == 'refs/heads/main'"
# GitHub expression syntax must remain literal in these assertions.
# shellcheck disable=SC2016
assert_contains "$PLAN_WORKFLOW" 'terraform-${{ inputs.target_account_alias }}-${{ inputs.terraform_component }}'
# shellcheck disable=SC2016
assert_contains "$APPLY_WORKFLOW" 'terraform-${{ inputs.target_account_alias }}-${{ inputs.terraform_component }}'
assert_contains "$PLAN_WORKFLOW" "select-execution-role.sh"
assert_contains "$APPLY_WORKFLOW" "select-execution-role.sh"
assert_contains "$PLAN_WORKFLOW" "preflight-iam-policy-account.sh"
assert_contains "$APPLY_WORKFLOW" "preflight-iam-policy-account.sh"
assert_contains "$PLAN_WORKFLOW" "iam_policy_plan_role_arn"
assert_contains "$APPLY_WORKFLOW" "iam_policy_apply_role_arn"
assert_contains "$PREFLIGHT_SCRIPT" "terraform -chdir=\"\$tf_root\" state list"
assert_contains "$PREFLIGHT_SCRIPT" "No state file was found"
assert_contains "$PREFLIGHT_SCRIPT" "NoSuchEntity"
assert_not_contains "$PREFLIGHT_SCRIPT" "terraform import"
assert_not_contains "$PREFLIGHT_SCRIPT" "detach-role-policy"
assert_not_contains "$PREFLIGHT_SCRIPT" "delete-policy"
assert_contains "$VALIDATE_WORKFLOW" 'terraform-provider-lock-cognito'
assert_contains "$VALIDATE_WORKFLOW" 'terraform providers lock'
assert_contains "$VALIDATE_WORKFLOW" 'Do not execute Terraform locally.'
assert_contains "$VALIDATE_WORKFLOW" 'needs: lockfiles'
assert_contains "$VALIDATE_WORKFLOW" 'test-securityhub-inspector-source-guard.sh'
assert_contains "$VALIDATE_WORKFLOW" 'test-securityhub-inspector-runbook.sh'
assert_not_contains "$VALIDATE_WORKFLOW" 'terraform apply'
assert_not_contains "$VALIDATE_WORKFLOW" 'terraform destroy'
