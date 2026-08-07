#!/usr/bin/env bash
set -euo pipefail

tf_root="${1:?Terraform root is required}"
expected_account_id="${2:?expected account ID is required}"
plan_role_arn="${3:?normal plan role ARN is required}"
apply_role_arn="${4:?normal apply role ARN is required}"

fail() {
  echo "::error::IAM policy-management fresh-account preflight failed: $*" >&2
  exit 1
}

[[ -d "$tf_root" ]] || fail "Terraform root does not exist"
[[ "$expected_account_id" =~ ^[0-9]{12}$ ]] || fail "invalid expected account ID"
[[ "$plan_role_arn" == "arn:aws:iam::${expected_account_id}:role/CrewSafeGitHubTerraformPlanRole" ]] \
  || fail "normal plan role ARN is not the approved target"
[[ "$apply_role_arn" == "arn:aws:iam::${expected_account_id}:role/CrewSafeGitHubTerraformApplyRole" ]] \
  || fail "normal apply role ARN is not the approved target"

state_error="$(mktemp)"
if state_resources="$(terraform -chdir="$tf_root" state list 2>"$state_error")"; then
  :
elif grep -Fq 'No state file was found' "$state_error"; then
  state_resources=""
  echo "::notice::IAM policy-management preflight found no component state file; treating the fresh account as empty."
else
  error_context="$(sed -n '1,3p' "$state_error" 2>/dev/null || true)"
  rm -f "$state_error"
  fail "unable to inspect reviewed remote state${error_context:+: $error_context}"
fi
rm -f "$state_error"

components=(cognito compute database ecr network secrets)
role_kinds=(plan apply)
policy_path="/crewsafe/terraform/iam-policy-management/"
policy_count=0
attachment_count=0

check_role() {
  local role_arn="$1" role_name="$2" role_json
  role_json="$(aws iam get-role --role-name "$role_name" --output json --no-cli-pager)" \
    || fail "required bootstrap role is missing: $role_name"
  jq -e --arg expected "$role_arn" '.Role.Arn == $expected' <<<"$role_json" >/dev/null \
    || fail "bootstrap role ARN mismatch: $role_name"
}

check_role "$plan_role_arn" CrewSafeGitHubTerraformPlanRole
check_role "$apply_role_arn" CrewSafeGitHubTerraformApplyRole

for component in "${components[@]}"; do
  for role_kind in "${role_kinds[@]}"; do
    binding_key="${component}-${role_kind}"
    policy_name="crewsafe-terraform-${binding_key}-policy"
    policy_arn="arn:aws:iam::${expected_account_id}:policy${policy_path}${policy_name}"
    policy_address="aws_iam_policy.component[\"${binding_key}\"]"
    attachment_address="aws_iam_role_policy_attachment.component[\"${binding_key}\"]"
    policy_error="$(mktemp)"

    if aws iam get-policy --policy-arn "$policy_arn" --output json --no-cli-pager >/dev/null 2>"$policy_error"; then
      rm -f "$policy_error"
      grep -Fqx "$policy_address" <<<"$state_resources" \
        || fail "unexpected existing customer-managed policy: $policy_arn"
    else
      if ! grep -Fq 'NoSuchEntity' "$policy_error"; then
        error_context="$(sed -n '1,3p' "$policy_error")"
        rm -f "$policy_error"
        fail "unable to inspect policy $policy_arn${error_context:+: $error_context}"
      fi
      rm -f "$policy_error"
    fi

    target_role="CrewSafeGitHubTerraformPlanRole"
    [[ "$role_kind" == apply ]] && target_role="CrewSafeGitHubTerraformApplyRole"
    attached="$(aws iam list-attached-role-policies --role-name "$target_role" --output json --no-cli-pager)" \
      || fail "unable to inspect attached policies for $target_role"
    if jq -e --arg policy_arn "$policy_arn" 'any(.AttachedPolicies[]?; .PolicyArn == $policy_arn)' <<<"$attached" >/dev/null; then
      grep -Fqx "$attachment_address" <<<"$state_resources" \
        || fail "unexpected existing attachment: $policy_arn -> $target_role"
    fi

    policy_count=$((policy_count + 1))
    attachment_count=$((attachment_count + 1))
  done
done

echo "::notice::IAM policy-management preflight passed: ${policy_count} declared policies and ${attachment_count} attachments are clear or already tracked in reviewed state."
