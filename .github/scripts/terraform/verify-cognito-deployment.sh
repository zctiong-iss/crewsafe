#!/usr/bin/env bash
set -euo pipefail

tf_root="${1:?Terraform root}"
expected_account="${2:?account ID}"
expected_region="${3:?Region}"
expected_state_key="${4:-crewsafe/cognito/shared-dev.tfstate}"

fail() {
  echo "::error::Shared Cognito deployment verification failed: $1" >&2
  exit 1
}

[[ "$expected_account" =~ ^[0-9]{12}$ ]] || fail "invalid expected account"
[[ "$expected_region" == ap-southeast-1 ]] || fail "unexpected Region"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$expected_account" ]] \
  || fail "caller account mismatch"

backend="$tf_root/.backend/state.s3.tfbackend"
[[ -f "$backend" ]] || fail "backend evidence missing"
grep -Fqx "key = \"$expected_state_key\"" "$backend" || fail "state key mismatch"
grep -Fqx "region = \"$expected_region\"" "$backend" || fail "backend Region mismatch"

pool_id="$(terraform -chdir="$tf_root" output -raw user_pool_id)"
[[ "$pool_id" =~ ^${expected_region}_[A-Za-z0-9]+$ ]] || fail "invalid pool identifier"
issuer="$(terraform -chdir="$tf_root" output -raw issuer_uri)"
[[ "$issuer" == "https://cognito-idp.${expected_region}.amazonaws.com/${pool_id}" ]] \
  || fail "issuer mismatch"

pool="$(aws cognito-idp describe-user-pool --user-pool-id "$pool_id" --output json)"
jq -e '
  .UserPool.Name == "crewsafe-shared-dev"
  and .UserPool.DeletionProtection == "ACTIVE"
  and .UserPool.UserPoolTier == "ESSENTIALS"
  and .UserPool.AdminCreateUserConfig.AllowAdminCreateUserOnly == true
  and .UserPool.UsernameConfiguration.CaseSensitive == false
  and .UserPool.UsernameAttributes == ["email"]
  and .UserPool.AutoVerifiedAttributes == ["email"]
  and .UserPool.MfaConfiguration == "OFF"
  and .UserPool.Policies.PasswordPolicy.TemporaryPasswordValidityDays == 30
' <<<"$pool" >/dev/null || fail "user-pool policy mismatch"

verify_client() {
  local output_name="$1"
  local expected_name="$2"
  local expected_direct_auth="$3"
  local expected_access_validity="$4"
  local expected_access_unit="$5"
  local client_id client
  client_id="$(terraform -chdir="$tf_root" output -raw "$output_name")"
  client="$(aws cognito-idp describe-user-pool-client \
    --user-pool-id "$pool_id" --client-id "$client_id" --output json)"
  jq -e --arg name "$expected_name" --argjson direct "$expected_direct_auth" \
    --argjson access_validity "$expected_access_validity" \
    --arg access_unit "$expected_access_unit" '
    .UserPoolClient.ClientName == $name
    and .UserPoolClient.GenerateSecret == false
    and .UserPoolClient.PreventUserExistenceErrors == "ENABLED"
    and .UserPoolClient.EnableTokenRevocation == true
    and .UserPoolClient.AccessTokenValidity == $access_validity
    and .UserPoolClient.TokenValidityUnits.AccessToken == $access_unit
    and ((.UserPoolClient.ExplicitAuthFlows | index("ALLOW_USER_PASSWORD_AUTH") != null) == $direct)
  ' <<<"$client" >/dev/null || fail "public client boundary mismatch"
}
verify_client web_client_id crewsafe-web false 15 minutes
verify_client mobile_client_id crewsafe-mobile false 1 hours
verify_client cli_client_id crewsafe-cli-integration true 15 minutes

domain_url="$(terraform -chdir="$tf_root" output -raw domain_url)"
domain_prefix="${domain_url#https://}"
domain_prefix="${domain_prefix%%.auth.*}"
domain="$(aws cognito-idp describe-user-pool-domain --domain "$domain_prefix" --output json)"
jq -e --arg pool "$pool_id" \
  '.DomainDescription.UserPoolId == $pool and .DomainDescription.Status == "ACTIVE"' \
  <<<"$domain" >/dev/null || fail "Hosted UI domain mismatch"

groups="$(aws cognito-idp list-groups --user-pool-id "$pool_id" --output json)"
jq -e '
  [.Groups[].GroupName] | sort == ["developers", "synthetic-test-users"]
' <<<"$groups" >/dev/null || fail "group boundary mismatch"
jq -e 'all(.Groups[]; (.RoleArn == null) and (.Precedence == null))' \
  <<<"$groups" >/dev/null || fail "groups unexpectedly confer IAM role or precedence"

admin_role_arn="$(terraform -chdir="$tf_root" output -raw administration_role_arn)"
[[ "$admin_role_arn" == "arn:aws:iam::${expected_account}:role/CrewSafeGitHubCognitoAdminRole" ]] \
  || fail "administration role mismatch"
role="$(aws iam get-role --role-name CrewSafeGitHubCognitoAdminRole --output json)"
jq -e '
  .Role.AssumeRolePolicyDocument.Statement
  | any(
      .Action == "sts:AssumeRoleWithWebIdentity"
      and (.Condition.StringEquals["token.actions.githubusercontent.com:sub"]
        | test("^repo:[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+:ref:refs/heads/main$"))
      and (.Condition.StringEquals["token.actions.githubusercontent.com:sub"] | contains("*") | not)
    )
' <<<"$role" >/dev/null || fail "administration role trust mismatch"

curl --fail --silent --show-error "${issuer}/.well-known/jwks.json" \
  | jq -e '.keys | type == "array" and length > 0' >/dev/null \
  || fail "JWKS unavailable"

echo "Shared Cognito deployment boundary verified."
