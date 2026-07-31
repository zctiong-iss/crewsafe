#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/helpers/synthetic-test-helpers.sh"

registry='{"alice":{"account_id":"123456789012","region":"ap-southeast-1"},"empty":{"account_id":"210987654321","region":"ap-southeast-1"}}'
fixture="$TEST_ROOT/.github/scripts/cognito/tests/fixtures/synthetic/valid.yml"
shared='{
  "schema_version":1,
  "accounts":{"alice":{
    "region":"ap-southeast-1",
    "user_pool_id":"ap-southeast-1_Example",
    "issuer_uri":"https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_Example",
    "jwks_uri":"https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_Example/.well-known/jwks.json",
    "hosted_ui_url":"https://crewsafe-example.auth.ap-southeast-1.amazoncognito.com",
    "web_client_id":"web123","mobile_client_id":"mobile123","cli_client_id":"cli123",
    "groups":["developers","synthetic-test-users"],
    "application_users":[{
      "username":"developer-one",
      "cognito_sub":"developer-subject",
      "display_name":"Developer One",
      "role":"ADMIN",
      "site_codes":["bishan","campus"],
      "identity_kind":"developer"
    }]
  }}
}'
builder="$TEST_ROOT/.github/scripts/cognito/build-runtime-mappings.sh"

output="$(
  CREWSAFE_AWS_ACCOUNTS_JSON="$registry" \
  CREWSAFE_SHARED_COGNITO_JSON="$shared" \
  SYNTHETIC_USERS_FILE="$fixture" \
    "$builder" alice
)"
jq -e '
  length == 3
  and any(.[]; .username == "developer-one"
    and .identityKind == "developer" and .desiredStatus == "preserve")
  and any(.[]; .username == "synthetic-supervisor@synthetic.crewsafe.invalid"
    and .identityKind == "synthetic-test" and .desiredStatus == "enabled")
  and any(.[]; .username == "synthetic-safety-manager@synthetic.crewsafe.invalid"
    and .desiredStatus == "disabled")
  and all(.[]; .cognitoSub != null)
' <<<"$output" >/dev/null

conflict="$(
  jq '.accounts.alice.application_users[0].cognito_sub =
    "00000000-0000-0000-0000-000000000002"' <<<"$shared"
)"
if CREWSAFE_AWS_ACCOUNTS_JSON="$registry" \
  CREWSAFE_SHARED_COGNITO_JSON="$conflict" \
  SYNTHETIC_USERS_FILE="$fixture" \
  "$builder" alice >/dev/null 2>&1; then
  fail "runtime mapping accepted duplicate immutable subject"
fi

printf 'Synthetic runtime mapping: PASS\n'
