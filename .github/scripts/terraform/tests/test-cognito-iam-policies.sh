#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/helpers/test-helpers.sh"

main="$ROOT/infra/terraform/cognito/main.tf"
plan="$ROOT/infra/terraform/cognito/iam/plan-role-policy.json"
apply="$ROOT/infra/terraform/cognito/iam/apply-role-policy.json"

jq empty "$plan"
jq empty "$apply"
grep -Eq 'token.actions.githubusercontent.com:sub.*github_oidc_main_subject' "$main"
grep -Eq 'Resource = aws_cognito_user_pool.shared_dev.arn' "$main"

for action in AdminCreateUser AdminDeleteUser AdminSetUserPassword AdminUpdateUserAttributes; do
  if grep -Eq "\"cognito-idp:$action\"" "$main"; then
    fail "administration role permits forbidden action $action"
  fi
done

jq -e '
  [.. | objects | .Action? // empty] | flatten as $actions
  | (["cognito-idp:GetUserPoolMfaConfig", "iam:ListAttachedRolePolicies"] - $actions | length) == 0
  and ($actions | index("cognito-idp:SetUserPoolMfaConfig")) == null
  and ($actions | index("cognito-idp:CreateUserPool")) == null
  and ($actions | index("iam:CreateRole")) == null
' "$plan" >/dev/null
jq -e '
  [.. | objects | .Action? // empty] | flatten as $actions
  | ([
      "cognito-idp:GetUserPoolMfaConfig",
      "cognito-idp:SetUserPoolMfaConfig",
      "iam:ListAttachedRolePolicies"
    ] - $actions | length) == 0
  and ($actions | index("cognito-idp:CreateUserPool")) != null
  and ($actions | index("iam:CreateRole")) != null
  and ($actions | index("cognito-idp:AdminCreateUser")) == null
  and ($actions | index("cognito-idp:AdminDeleteUser")) == null
  and ($actions | index("cognito-idp:AdminSetUserPassword")) == null
' "$apply" >/dev/null
