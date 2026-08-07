#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/helpers/test-helpers.sh"

bootstrap_root="$ROOT/infra/terraform/iam-policy-management/bootstrap"
account_id="123456789012"
oidc_subject="repo:zctiong-iss@267492605/crewsafe@1310783821:ref:refs/heads/main"
bucket="arn:aws:s3:::crewsafe-terraform-state-${account_id}-ap-southeast-1"
policy_arn="arn:aws:iam::${account_id}:policy/crewsafe/terraform/iam-policy-management/*"
plan_role="arn:aws:iam::${account_id}:role/CrewSafeGitHubTerraformIamPolicyPlanRole"
apply_role="arn:aws:iam::${account_id}:role/CrewSafeGitHubTerraformIamPolicyApplyRole"
normal_plan_role="arn:aws:iam::${account_id}:role/CrewSafeGitHubTerraformPlanRole"
normal_apply_role="arn:aws:iam::${account_id}:role/CrewSafeGitHubTerraformApplyRole"

for artifact in trust-policy.json.tftpl plan-role-policy.json.tftpl apply-role-policy.json.tftpl README.md; do
  assert_file "infra/terraform/iam-policy-management/bootstrap/$artifact"
done

bootstrap_readme="$bootstrap_root/README.md"
grep -Fq -- '--path /crewsafe/terraform/bootstrap/' "$bootstrap_readme" \
  || fail "bootstrap README must use the reviewed managed-policy path"
grep -Fq 'CrewSafeGitHubTerraformIamPolicyPlan' "$bootstrap_readme" \
  || fail "bootstrap README must name the dedicated plan permission policy"
grep -Fq 'CrewSafeGitHubTerraformIamPolicyApply' "$bootstrap_readme" \
  || fail "bootstrap README must name the dedicated apply permission policy"

render() {
  sed \
    -e "s/<ACCOUNT_ID>/${account_id}/g" \
    -e "s#<GITHUB_OIDC_MAIN_SUBJECT>#${oidc_subject}#g" \
    "$1"
}

trust="$(render "$bootstrap_root/trust-policy.json.tftpl")"
jq -e \
  --arg provider "arn:aws:iam::${account_id}:oidc-provider/token.actions.githubusercontent.com" \
  --arg subject "$oidc_subject" \
  '.Version == "2012-10-17"
   and (.Statement | length == 1)
   and .Statement[0].Effect == "Allow"
   and .Statement[0].Principal.Federated == $provider
   and .Statement[0].Action == "sts:AssumeRoleWithWebIdentity"
   and .Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:aud"] == "sts.amazonaws.com"
   and .Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"] == $subject' \
  <<<"$trust" >/dev/null

for role_kind in plan apply; do
  policy="$bootstrap_root/${role_kind}-role-policy.json.tftpl"
  rendered="$(render "$policy")"
  jq empty <<<"$rendered"
  if grep -Fq '<' <<<"$rendered"; then
    fail "unresolved bootstrap-policy placeholder in $policy"
  fi

  jq -e \
    --arg bucket "$bucket" \
    --arg policy_arn "$policy_arn" \
    --arg plan_role "$normal_plan_role" \
    --arg apply_role "$normal_apply_role" \
    --arg execution_plan_role "$plan_role" \
    --arg execution_apply_role "$apply_role" \
    --argjson role_kind "$([ "$role_kind" = plan ] && echo '"plan"' || echo '"apply"')" \
    '(.Version == "2012-10-17")
     and ([.Statement[] | select(.Effect == "Allow") | .Action
           | if type == "array" then .[] else . end]
          | all(. != "iam:CreateRole" and . != "iam:UpdateAssumeRolePolicy"
                and . != "iam:PutRolePolicy" and . != "iam:DeleteRolePolicy"
                and . != "iam:CreateOpenIDConnectProvider"))
     and ([.Statement[] | select(.Effect == "Deny") | .Action
           | if type == "array" then .[] else . end]
          | (index("iam:CreateRole") != null)
          and (index("iam:UpdateAssumeRolePolicy") != null)
          and (index("iam:PutRolePolicy") != null)
          and (index("iam:DeleteRolePolicy") != null)
          and (index("iam:CreateOpenIDConnectProvider") != null))
     and ([.Statement[] | select(.Effect == "Allow") | .Resource
           | if type == "array" then .[] else . end]
          | (index($bucket) != null)
          and (index(($bucket + "/crewsafe/bootstrap/terraform.tfstate")) != null)
          and (index(($bucket + "/crewsafe/iam-policy-management/shared-dev.tfstate")) != null)
          and (index(($bucket + "/crewsafe/iam-policy-management/shared-dev.tfstate.tflock")) != null))
     and ([.Statement[] | select(.Effect == "Allow") | .Resource
           | if type == "array" then .[] else . end]
          | (index($policy_arn) != null))
     and ([.Statement[] | select(.Effect == "Allow") | .Resource
           | if type == "array" then .[] else . end]
          | (index($plan_role) != null)
          and (index($apply_role) != null))
     and ($role_kind == "plan" or
          (any(.Statement[]; .Sid == "CreateDeclaredManagedPolicies"
               and .Condition.StringEquals["iam:PolicyPath"] == "/crewsafe/terraform/iam-policy-management/")
           and
          ([.Statement[] | select(.Effect == "Allow") | .Action
            | if type == "array" then .[] else . end]
           | (index("iam:CreatePolicy") != null)
           and (index("iam:CreatePolicyVersion") != null)
           and (index("iam:SetDefaultPolicyVersion") != null)
           and (index("iam:DeletePolicyVersion") != null)
           and (index("iam:TagPolicy") != null)
           and (index("iam:AttachRolePolicy") != null)
           and (index("iam:DetachRolePolicy") != null))))' \
    <<<"$rendered" >/dev/null || fail "bootstrap policy boundary failed for $policy"
done

echo "PASS: dedicated IAM policy-management bootstrap artifacts satisfy the static boundary checks."
