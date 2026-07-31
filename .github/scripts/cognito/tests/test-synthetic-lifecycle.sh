#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/helpers/synthetic-test-helpers.sh"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
log="$tmp/aws.log"
stub="$TEST_ROOT/.github/scripts/cognito/tests/fixtures/aws-synthetic-lifecycle/stub-aws.sh"
enabled="$TEST_ROOT/.github/scripts/cognito/tests/fixtures/aws-synthetic-lifecycle/bound-enabled.yml"
disabled="$TEST_ROOT/.github/scripts/cognito/tests/fixtures/aws-synthetic-lifecycle/bound-disabled.yml"
runner="$TEST_ROOT/.github/scripts/cognito/reconcile-synthetic-users.sh"
registry='{"alice":{"account_id":"123456789012","region":"ap-southeast-1"}}'
shared='{
  "schema_version":1,
  "accounts":{"alice":{
    "region":"ap-southeast-1","user_pool_id":"ap-southeast-1_Example",
    "issuer_uri":"https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_Example",
    "jwks_uri":"https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_Example/.well-known/jwks.json",
    "hosted_ui_url":"https://crewsafe-example.auth.ap-southeast-1.amazoncognito.com",
    "web_client_id":"web123","mobile_client_id":"mobile123","cli_client_id":"cli123",
    "groups":["developers","synthetic-test-users"],"application_users":[]
  }}
}'
common=(
  CREWSAFE_AWS_ACCOUNTS_JSON="$registry"
  CREWSAFE_SHARED_COGNITO_JSON="$shared"
  AWS_CLI="$stub"
  AWS_STUB_LOG="$log"
  GITHUB_SHA=1111111111111111111111111111111111111111
  GITHUB_RUN_ID=5678
  GITHUB_ACTOR=actor
)

status_mismatch="$(
  env "${common[@]}" AWS_STUB_ENABLED=false SYNTHETIC_USERS_FILE="$enabled" \
    "$runner" alice reconcile-synthetic demo-worker ap-southeast-1_Example
)"
jq -e '.result == "status-mismatch"' <<<"$status_mismatch" >/dev/null
if grep -Eq 'admin-(enable|disable)' "$log"; then
  fail "ordinary reconciliation silently changed authentication status"
fi

: >"$log"
if env "${common[@]}" AWS_STUB_ENABLED=false SYNTHETIC_USERS_FILE="$enabled" \
  "$runner" alice rotate-synthetic demo-worker ap-southeast-1_Example \
  >/dev/null 2>&1; then
  fail "credential rotation accepted a disabled live identity"
fi
if env "${common[@]}" SYNTHETIC_USERS_FILE="$disabled" \
  "$runner" alice enable-synthetic demo-worker ap-southeast-1_Example \
  >/dev/null 2>&1; then
  fail "enablement accepted a declaration that was not reviewed as enabled"
fi

: >"$log"
partial_error="$tmp/partial-error.log"
if env "${common[@]}" \
  AWS_STUB_FAIL_ACTION=cognito-idp/admin-set-user-password \
  SYNTHETIC_USERS_FILE="$enabled" \
  "$runner" alice rotate-synthetic demo-worker ap-southeast-1_Example \
  >"$tmp/partial-output" 2>"$partial_error"; then
  fail "partial credential rotation failure was reported as success"
fi
grep -Fq 'requires documented recovery before retry' "$partial_error"
if grep -Fq 'cognito-idp admin-user-global-sign-out' "$log"; then
  fail "rotation continued after an ambiguous partial failure"
fi
assert_no_sensitive_output "$(<"$partial_error")"

: >"$log"
rotate="$(
  env "${common[@]}" SYNTHETIC_USERS_FILE="$enabled" \
    "$runner" alice rotate-synthetic demo-worker ap-southeast-1_Example
)"
jq -e '.result == "updated"' <<<"$rotate" >/dev/null
grep -Fq 'secretsmanager put-secret-value' "$log"
grep -Fq 'cognito-idp admin-set-user-password' "$log"
grep -Fq 'cognito-idp admin-user-global-sign-out' "$log"

: >"$log"
disable="$(
  env "${common[@]}" SYNTHETIC_USERS_FILE="$disabled" \
    "$runner" alice disable-synthetic demo-worker ap-southeast-1_Example
)"
jq -e '.result == "disabled"' <<<"$disable" >/dev/null
grep -Fq 'cognito-idp admin-disable-user' "$log"
grep -Fq 'cognito-idp admin-user-global-sign-out' "$log"

: >"$log"
enable="$(
  env "${common[@]}" AWS_STUB_ENABLED=false SYNTHETIC_USERS_FILE="$enabled" \
    "$runner" alice enable-synthetic demo-worker ap-southeast-1_Example
)"
jq -e '.result == "enabled"' <<<"$enable" >/dev/null
grep -Fq 'cognito-idp admin-enable-user' "$log"
if grep -Eq 'get-random-password|put-secret-value|admin-set-user-password' "$log"; then
  fail "enablement changed the protected credential"
fi

: >"$log"
already_enabled="$(
  env "${common[@]}" SYNTHETIC_USERS_FILE="$enabled" \
    "$runner" alice enable-synthetic demo-worker ap-southeast-1_Example
)"
jq -e '.result == "unchanged"' <<<"$already_enabled" >/dev/null
if grep -Fq 'cognito-idp admin-enable-user' "$log"; then
  fail "already-enabled identity received a duplicate enable mutation"
fi

: >"$log"
already_disabled="$(
  env "${common[@]}" AWS_STUB_ENABLED=false SYNTHETIC_USERS_FILE="$disabled" \
    "$runner" alice disable-synthetic demo-worker ap-southeast-1_Example
)"
jq -e '.result == "disabled"' <<<"$already_disabled" >/dev/null
if grep -Eq 'admin-disable-user|admin-user-global-sign-out' "$log"; then
  fail "already-disabled identity received a duplicate lifecycle mutation"
fi

empty="$tmp/empty.yml"
printf 'schema_version: 1\naccounts:\n  alice: []\n' >"$empty"
: >"$log"
unmanaged="$(
  env "${common[@]}" SYNTHETIC_USERS_FILE="$empty" \
    "$runner" alice reconcile-synthetic all ap-southeast-1_Example
)"
jq -e '.result == "unmanaged"' <<<"$unmanaged" >/dev/null
if grep -Eq 'admin-(enable|disable|set-user-password|add-user-to-group|delete)' "$log"; then
  fail "omitted synthetic user was mutated"
fi
if grep -Eq 'admin-delete-user|delete-secret' "$log"; then
  fail "permanent deletion API was called"
fi

printf 'Synthetic lifecycle contract: PASS\n'
