#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/helpers/test-helpers.sh"

main="$ROOT/infra/terraform/cognito/main.tf"
plan="$ROOT/infra/terraform/cognito/iam/plan-role-policy.json"
apply="$ROOT/infra/terraform/cognito/iam/apply-role-policy.json"

jq empty "$plan"
jq empty "$apply"
rg -q 'token.actions.githubusercontent.com:sub.*github_oidc_main_subject' "$main"
rg -q 'Resource = aws_cognito_user_pool.shared_dev.arn' "$main"

for action in AdminCreateUser AdminDeleteUser AdminSetUserPassword AdminUpdateUserAttributes; do
  if rg -q "\"cognito-idp:$action\"" "$main"; then
    fail "administration role permits forbidden action $action"
  fi
done

jq -e '
  [.. | objects | .Action? // empty] | flatten
  | index("cognito-idp:CreateUserPool") == null
  and index("iam:CreateRole") == null
' "$plan" >/dev/null
jq -e '
  [.. | objects | .Action? // empty] | flatten
  | index("cognito-idp:CreateUserPool") != null
  and index("iam:CreateRole") != null
  and index("cognito-idp:AdminCreateUser") == null
  and index("cognito-idp:AdminDeleteUser") == null
  and index("cognito-idp:AdminSetUserPassword") == null
' "$apply" >/dev/null
