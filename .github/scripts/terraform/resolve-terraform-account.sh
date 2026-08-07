#!/usr/bin/env bash
set -euo pipefail

alias_name="${1:-}"
registry="${CREWSAFE_AWS_ACCOUNTS_JSON:-}"

if [[ ! "$alias_name" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "::error::Account alias must use lowercase letters, digits, and single hyphens." >&2
  exit 1
fi

if [[ -z "$registry" ]] || ! jq -e 'type == "object" and length > 0' <<<"$registry" >/dev/null; then
  echo "::error::CREWSAFE_AWS_ACCOUNTS_JSON must be a non-empty JSON object." >&2
  exit 1
fi

if ! jq -e 'all(keys[]; test("^[a-z0-9]+(-[a-z0-9]+)*$"))' <<<"$registry" >/dev/null; then
  echo "::error::Every account registry key must be a valid alias." >&2
  exit 1
fi

entry="$(jq -cer --arg alias_name "$alias_name" '.[$alias_name] // empty' <<<"$registry")" || {
  echo "::error::Unknown account alias: $alias_name" >&2
  exit 1
}

if ! jq -e '
  type == "object"
  and ((keys | sort) == ["account_id", "apply_role_arn", "plan_role_arn", "region"]
    or (keys | sort) == ["account_id", "apply_role_arn", "iam_policy_apply_role_arn", "iam_policy_plan_role_arn", "plan_role_arn", "region"])
  and (.account_id | type == "string" and test("^[0-9]{12}$"))
  and .region == "ap-southeast-1"
  and (.plan_role_arn | type == "string")
  and (.apply_role_arn | type == "string")
  and ((has("iam_policy_plan_role_arn") and has("iam_policy_apply_role_arn")
    and (.iam_policy_plan_role_arn | type == "string")
    and (.iam_policy_apply_role_arn | type == "string"))
    or ((has("iam_policy_plan_role_arn") | not) and (has("iam_policy_apply_role_arn") | not)))
' <<<"$entry" >/dev/null; then
  echo "::error::Registry entry has an invalid schema, account ID, or Region." >&2
  exit 1
fi

account_id="$(jq -r '.account_id' <<<"$entry")"
region="$(jq -r '.region' <<<"$entry")"
plan_role_arn="$(jq -r '.plan_role_arn' <<<"$entry")"
apply_role_arn="$(jq -r '.apply_role_arn' <<<"$entry")"
iam_policy_plan_role_arn="$(jq -r '.iam_policy_plan_role_arn // empty' <<<"$entry")"
iam_policy_apply_role_arn="$(jq -r '.iam_policy_apply_role_arn // empty' <<<"$entry")"

plan_role_pattern="^arn:aws:iam::${account_id}:role/(.*/)?CrewSafeGitHubTerraformPlanRole$"
apply_role_pattern="^arn:aws:iam::${account_id}:role/(.*/)?CrewSafeGitHubTerraformApplyRole$"

if [[ ! "$plan_role_arn" =~ $plan_role_pattern ]]; then
  echo "::error::Plan role ARN does not match the selected account and required role name." >&2
  exit 1
fi

if [[ ! "$apply_role_arn" =~ $apply_role_pattern ]]; then
  echo "::error::Apply role ARN does not match the selected account and required role name." >&2
  exit 1
fi

if [[ "$plan_role_arn" == "$apply_role_arn" ]]; then
  echo "::error::Plan and apply must use different IAM roles." >&2
  exit 1
fi

if [[ -n "$iam_policy_plan_role_arn" ]]; then
  iam_policy_plan_role_pattern="^arn:aws:iam::${account_id}:role/CrewSafeGitHubTerraformIamPolicyPlanRole$"
  iam_policy_apply_role_pattern="^arn:aws:iam::${account_id}:role/CrewSafeGitHubTerraformIamPolicyApplyRole$"

  if [[ ! "$iam_policy_plan_role_arn" =~ $iam_policy_plan_role_pattern ]]; then
    echo "::error::IAM policy-management plan role ARN does not match the selected account and required role name." >&2
    exit 1
  fi
  if [[ ! "$iam_policy_apply_role_arn" =~ $iam_policy_apply_role_pattern ]]; then
    echo "::error::IAM policy-management apply role ARN does not match the selected account and required role name." >&2
    exit 1
  fi
  for role_arn in "$iam_policy_plan_role_arn" "$iam_policy_apply_role_arn"; do
    if [[ "$role_arn" == "$plan_role_arn" || "$role_arn" == "$apply_role_arn" ]]; then
      echo "::error::Policy-management roles must be separate from normal Terraform roles." >&2
      exit 1
    fi
  done
  [[ "$iam_policy_plan_role_arn" != "$iam_policy_apply_role_arn" ]] || {
    echo "::error::Policy-management plan and apply must use different IAM roles." >&2
    exit 1
  }
fi

bucket="crewsafe-terraform-state-${account_id}-${region}"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    printf 'account_alias=%s\n' "$alias_name"
    printf 'account_id=%s\n' "$account_id"
    printf 'region=%s\n' "$region"
    printf 'plan_role_arn=%s\n' "$plan_role_arn"
    printf 'apply_role_arn=%s\n' "$apply_role_arn"
    if [[ -n "$iam_policy_plan_role_arn" ]]; then
      printf 'iam_policy_plan_role_arn=%s\n' "$iam_policy_plan_role_arn"
      printf 'iam_policy_apply_role_arn=%s\n' "$iam_policy_apply_role_arn"
    fi
    printf 'bucket=%s\n' "$bucket"
  } >>"$GITHUB_OUTPUT"
else
  jq -n \
    --arg account_alias "$alias_name" \
    --arg account_id "$account_id" \
    --arg region "$region" \
    --arg plan_role_arn "$plan_role_arn" \
    --arg apply_role_arn "$apply_role_arn" \
    --arg iam_policy_plan_role_arn "$iam_policy_plan_role_arn" \
    --arg iam_policy_apply_role_arn "$iam_policy_apply_role_arn" \
    --arg bucket "$bucket" \
    '{account_alias: $account_alias, account_id: $account_id, region: $region, plan_role_arn: $plan_role_arn, apply_role_arn: $apply_role_arn, iam_policy_plan_role_arn: (if $iam_policy_plan_role_arn == "" then null else $iam_policy_plan_role_arn end), iam_policy_apply_role_arn: (if $iam_policy_apply_role_arn == "" then null else $iam_policy_apply_role_arn end), bucket: $bucket}'
fi
