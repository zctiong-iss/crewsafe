#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/helpers/synthetic-test-helpers.sh"

tmp="$(mktemp -d)"
log="$tmp/aws.log"
stub="$tmp/aws"
cleanup() {
  status=$?
  rm -rf "$tmp"
  exit "$status"
}
trap cleanup EXIT

cat >"$stub" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
service="${1:-}"
action="${2:-}"
shift 2
printf '%s %s\n' "$service" "$action" >>"$AWS_STUB_LOG"
case "$service/$action" in
  sts/get-caller-identity) printf '123456789012\n' ;;
  cognito-idp/admin-get-user)
    printf 'UserNotFoundException\n' >&2
    exit 254
    ;;
  cognito-idp/admin-create-user)
    username=""
    while [[ "$#" -gt 0 ]]; do
      if [[ "$1" == --username ]]; then
        username="$2"
        break
      fi
      shift
    done
    suffix="${username%%@*}"
    suffix="${suffix##*-}"
    printf '{"User":{"Attributes":[{"Name":"sub","Value":"00000000-0000-0000-0000-0000000000%s"}]}}\n' \
      "$suffix"
    ;;
  cognito-idp/list-users) printf '{"Users":[]}\n' ;;
  secretsmanager/get-random-password) printf 'Generated-Redacted-Aa1!\n' ;;
  *) printf '{}\n' ;;
esac
STUB
chmod +x "$stub"

registry='{"perf":{"account_id":"123456789012","region":"ap-southeast-1"}}'
shared='{
  "schema_version":1,
  "accounts":{"perf":{
    "region":"ap-southeast-1",
    "user_pool_id":"ap-southeast-1_Performance",
    "issuer_uri":"https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_Performance",
    "jwks_uri":"https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_Performance/.well-known/jwks.json",
    "hosted_ui_url":"https://crewsafe-performance.auth.ap-southeast-1.amazoncognito.com",
    "web_client_id":"web123","mobile_client_id":"mobile123","cli_client_id":"cli123",
    "groups":["developers","synthetic-test-users"],"application_users":[]
  }}
}'
fixture="$TEST_ROOT/.github/scripts/cognito/tests/fixtures/synthetic/performance-20.yml"
runner="$TEST_ROOT/.github/scripts/cognito/reconcile-synthetic-users.sh"

validation_started="$(date +%s)"
summary="$(
  CREWSAFE_AWS_ACCOUNTS_JSON="$registry" SYNTHETIC_USERS_FILE="$fixture" \
    "$SYNTHETIC_RESOLVER"
)"
validation_elapsed="$(( $(date +%s) - validation_started ))"
jq -e '.accounts.perf.count == 20' <<<"$summary" >/dev/null
(( validation_elapsed < 300 )) ||
  fail "20-user validation exceeded the five-minute target"

reconcile_started="$(date +%s)"
results="$(
  CREWSAFE_AWS_ACCOUNTS_JSON="$registry" \
  CREWSAFE_SHARED_COGNITO_JSON="$shared" \
  SYNTHETIC_USERS_FILE="$fixture" \
  AWS_CLI="$stub" \
  AWS_STUB_LOG="$log" \
  GITHUB_SHA=1111111111111111111111111111111111111111 \
  GITHUB_RUN_ID=1234 \
  GITHUB_ACTOR=actor \
    "$runner" perf reconcile-synthetic all ap-southeast-1_Performance
)"
reconcile_elapsed="$(( $(date +%s) - reconcile_started ))"

[[ "$(wc -l <<<"$results" | tr -d ' ')" -eq 20 ]]
[[ "$(grep -c 'cognito-idp admin-create-user' "$log")" -eq 20 ]]
assert_no_sensitive_output "$results"
(( reconcile_elapsed < 600 )) ||
  fail "20-user reconciliation exceeded the ten-minute target"

printf 'Synthetic 20-user performance: validation=%ss reconciliation=%ss PASS\n' \
  "$validation_elapsed" "$reconcile_elapsed"
