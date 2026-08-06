#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/helpers/test-helpers.sh"

tf_root="$ROOT/infra/terraform/iam-policy-management"
catalog="$ROOT/.github/terraform/components.json"
selector="$ROOT/.github/scripts/terraform/select-execution-role.sh"
fixture_dir="$ROOT/.github/scripts/terraform/tests/fixtures/iam-policy-management"

assert_file "infra/terraform/iam-policy-management/main.tf"
assert_file "infra/terraform/iam-policy-management/.terraform.lock.hcl"
assert_file ".github/scripts/terraform/select-execution-role.sh"
assert_file ".github/scripts/terraform/preflight-iam-policy-account.sh"
assert_file ".github/scripts/terraform/tests/fixtures/iam-policy-management/authorization-boundary.json"
[[ "$(find "$tf_root/policies" -type f -name '*.json.tftpl' | wc -l | tr -d ' ')" == 12 ]] || fail "IAM policy-management root must contain exactly twelve policy templates"

jq -e '
  .components["iam-policy-management-shared-dev"].root == "infra/terraform/iam-policy-management"
  and .components["iam-policy-management-shared-dev"].state_key == "crewsafe/iam-policy-management/shared-dev.tfstate"
  and .components["iam-policy-management-shared-dev"].execution_role_family == "policy-management"
' "$catalog" >/dev/null

for component in cognito compute database ecr network secrets; do
  for role_kind in plan apply; do
    policy="$tf_root/policies/$component/$role_kind.json.tftpl"
    assert_file "infra/terraform/iam-policy-management/policies/$component/$role_kind.json.tftpl"
    legacy_policy="$ROOT/infra/terraform/$component/iam/${role_kind}-role-policy.json"
    cmp -s "$legacy_policy" "$policy" || fail "central policy template drifted from reviewed $legacy_policy"
    jq empty "$policy"
    if grep -Fq '<ACCOUNT_ID>' "$policy"; then
      rendered="$(sed 's/<ACCOUNT_ID>/123456789012/g' "$policy")"
      jq empty <<<"$rendered"
      if grep -Fq '<ACCOUNT_ID>' <<<"$rendered"; then
        fail "unresolved account placeholder in $policy"
      fi
    fi
  done
done

for fixture in "$fixture_dir"/*.json; do
  jq -e 'has("scenario") and has("expected")' "$fixture" >/dev/null || fail "invalid IAM policy-management fixture: $fixture"
done
jq -e '
  (.normal_plan_role.denied | index("iam:CreatePolicy") != null)
  and (.normal_apply_role.denied | index("iam:AttachRolePolicy") != null)
  and (.policy_management_apply_role.denied | index("iam:CreateRole") != null)
' "$fixture_dir/authorization-boundary.json" >/dev/null
jq -e '.default_version_must_be_preserved == true' "$fixture_dir/policy-version-limit.json" >/dev/null
jq -e '.state_repair == false and .manual_recreate_bootstrap_roles == false' "$fixture_dir/partial-apply.json" >/dev/null

if grep -R -Eq 'resource[[:space:]]+"aws_iam_role"|resource[[:space:]]+"aws_iam_role_policy"|resource[[:space:]]+"aws_iam_policy_attachment"|aws_iam_openid_connect_provider' "$tf_root"; then
  fail "IAM policy-management root owns a bootstrap role, inline policy, OIDC provider, or exclusive attachment"
fi

if grep -Fq 'rendered_policy' "$tf_root/outputs.tf"; then
  fail "Terraform outputs must not publish full policy documents"
fi

if grep -R -Eq '"Action"[[:space:]]*:[[:space:]]*[[^]]*"iam:*"|"Action"[[:space:]]*:[[:space:]]*"iam:*"' "$tf_root/policies"; then
  fail "component policy grants unrestricted IAM administration"
fi

if grep -Eq 'role-to-assume:.*steps.account.outputs.(plan_role_arn|apply_role_arn)' "$ROOT/.github/workflows/terraform-plan.yml" "$ROOT/.github/workflows/terraform-apply.yml"; then
  fail "IAM policy-management workflow directly assumes a normal Terraform role"
fi

registry='{"alice":{"account_id":"123456789012","region":"ap-southeast-1","plan_role_arn":"arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformPlanRole","apply_role_arn":"arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformApplyRole","iam_policy_plan_role_arn":"arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformIamPolicyPlanRole","iam_policy_apply_role_arn":"arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformIamPolicyApplyRole"}}'
standard_role="$("$selector" cognito-shared-dev plan standard "$(jq -r '.alice.plan_role_arn' <<<"$registry")" "$(jq -r '.alice.apply_role_arn' <<<"$registry")" "$(jq -r '.alice.iam_policy_plan_role_arn' <<<"$registry")" "$(jq -r '.alice.iam_policy_apply_role_arn' <<<"$registry")")"
[[ "$standard_role" == arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformPlanRole ]] || fail "standard component selected a policy-management role"

policy_role="$("$selector" iam-policy-management-shared-dev apply policy-management "$(jq -r '.alice.plan_role_arn' <<<"$registry")" "$(jq -r '.alice.apply_role_arn' <<<"$registry")" "$(jq -r '.alice.iam_policy_plan_role_arn' <<<"$registry")" "$(jq -r '.alice.iam_policy_apply_role_arn' <<<"$registry")")"
[[ "$policy_role" == arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformIamPolicyApplyRole ]] || fail "IAM component did not select dedicated apply role"

echo "PASS: IAM customer-managed policy and attachment boundary tests passed."
