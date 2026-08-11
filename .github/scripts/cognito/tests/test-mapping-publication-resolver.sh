#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
resolver="$ROOT/.github/scripts/cognito/resolve-mapping-publication.sh"
fixture="$ROOT/.github/scripts/cognito/tests/fixtures/aws-synthetic-lifecycle/bound-enabled.yml"

registry='{"alice":{"account_id":"123456789012","region":"ap-southeast-1","plan_role_arn":"arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformPlanRole","apply_role_arn":"arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformApplyRole"}}'
admins='{"schema_version":1,"accounts":{"alice":["operator"]}}'
shared='{"schema_version":1,"accounts":{"alice":{"region":"ap-southeast-1","user_pool_id":"ap-southeast-1_Example","issuer_uri":"https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_Example","jwks_uri":"https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_Example/.well-known/jwks.json","hosted_ui_url":"https://crewsafe-example.auth.ap-southeast-1.amazoncognito.com","web_client_id":"web123","mobile_client_id":"mobile123","cli_client_id":"cli123","groups":["developers","synthetic-test-users"],"application_users":[{"username":"developer-one","cognito_sub":"developer-subject","display_name":"Developer One","role":"ADMIN","site_codes":["bishan","campus"],"identity_kind":"developer"}]}}}'

run_resolver() {
  CREWSAFE_AWS_ACCOUNTS_JSON="$registry" \
  CREWSAFE_COGNITO_ADMINS_JSON="$admins" \
  CREWSAFE_SHARED_COGNITO_JSON="$shared" \
  SYNTHETIC_USERS_FILE="$fixture" \
  GITHUB_OUTPUT="" \
  WORKFLOW_REF="refs/heads/main" \
    "$resolver" alice operator "publish-mapping alice"
}

output="$(run_resolver)"
jq -e '
  .account_alias == "alice"
  and .parameter_name == "/crewsafe/shared-dev/cognito/demo-users-json"
  and .role_arn == "arn:aws:iam::123456789012:role/crewsafe-shared-dev-cognito-mapping-publish"
  and (.mapping_checksum | test("^[0-9a-f]{64}$"))
  and (has("mapping") | not)
' <<<"$output" >/dev/null

for mutation in actor ref confirmation alias; do
  case "$mutation" in
    actor) command=(alice intruder "publish-mapping alice"); ref_env=refs/heads/main; registry_env="$registry" ;;
    ref) command=(alice operator "publish-mapping alice"); ref_env=refs/heads/feature/test; registry_env="$registry" ;;
    confirmation) command=(alice operator "publish-mapping wrong"); ref_env=refs/heads/main; registry_env="$registry" ;;
    alias) command=(unknown operator "publish-mapping unknown"); ref_env=refs/heads/main; registry_env="$registry" ;;
  esac
  if CREWSAFE_AWS_ACCOUNTS_JSON="$registry_env" CREWSAFE_COGNITO_ADMINS_JSON="$admins" \
    CREWSAFE_SHARED_COGNITO_JSON="$shared" SYNTHETIC_USERS_FILE="$fixture" \
    GITHUB_OUTPUT="" \
    WORKFLOW_REF="$ref_env" "$resolver" "${command[@]}" >/dev/null 2>&1; then
    echo "publication resolver accepted unsafe $mutation" >&2
    exit 1
  fi
done

echo "Mapping publication resolver: PASS"
