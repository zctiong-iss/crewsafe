#!/usr/bin/env bash
set -euo pipefail

component="${1:-}"
operation="${2:-}"
execution_role_family="${3:-}"
normal_plan_role_arn="${4:-}"
normal_apply_role_arn="${5:-}"
iam_policy_plan_role_arn="${6:-}"
iam_policy_apply_role_arn="${7:-}"

[[ "$operation" == plan || "$operation" == apply ]] || {
  echo "::error::Execution-role operation must be plan or apply." >&2
  exit 1
}

case "$component" in
  iam-policy-management-shared-dev)
    [[ "$execution_role_family" == policy-management ]] || {
      echo "::error::IAM policy-management component has an unexpected execution-role family." >&2
      exit 1
    }
    if [[ "$operation" == plan ]]; then
      role_arn="$iam_policy_plan_role_arn"
    else
      role_arn="$iam_policy_apply_role_arn"
    fi
    [[ -n "$role_arn" ]] || {
      echo "::error::IAM policy-management execution role is missing from the selected account registry entry." >&2
      exit 1
    }
    ;;
  *)
    [[ "$execution_role_family" == standard ]] || {
      echo "::error::Standard Terraform component has an unexpected execution-role family." >&2
      exit 1
    }
    role_arn="$normal_plan_role_arn"
    [[ "$operation" == apply ]] && role_arn="$normal_apply_role_arn"
    ;;
esac

[[ "$role_arn" =~ ^arn:aws:iam::[0-9]{12}:role/[A-Za-z0-9+=,.@_-]+$ ]] || {
  echo "::error::Selected execution role ARN is malformed." >&2
  exit 1
}

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  printf 'role_arn=%s\n' "$role_arn" >>"$GITHUB_OUTPUT"
else
  printf '%s\n' "$role_arn"
fi
