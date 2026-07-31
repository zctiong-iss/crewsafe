#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/helpers/synthetic-test-helpers.sh"

tmp="$(mktemp -d)"
log="$tmp/aws.log"
state="$tmp/state"
stub="$tmp/aws"
cleanup() {
  status=$?
  if [[ "$status" -ne 0 && -f "$log" ]]; then
    sed -n '1,80p' "$log" >&2
  fi
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
printf '%s %s' "$service" "$action" >>"$AWS_STUB_LOG"
redact_next=false
for argument in "$@"; do
  if [[ "$redact_next" == true ]]; then
    printf ' [REDACTED]' >>"$AWS_STUB_LOG"
    redact_next=false
  elif [[ "$argument" == --secret-string || "$argument" == --temporary-password || "$argument" == --password ]]; then
    printf ' %s' "$argument" >>"$AWS_STUB_LOG"
    redact_next=true
  else
    printf ' %s' "$argument" >>"$AWS_STUB_LOG"
  fi
done
printf '\n' >>"$AWS_STUB_LOG"
case "$service/$action" in
  sts/get-caller-identity) printf '123456789012\n' ;;
  secretsmanager/get-random-password) printf 'Generated-%s-Aa1!\n' "$RANDOM" ;;
  secretsmanager/create-secret) printf '{"ARN":"arn:test:secret"}\n' ;;
  secretsmanager/describe-secret) printf '{"ARN":"arn:test:secret"}\n' ;;
  secretsmanager/put-secret-value) printf '{"VersionId":"version-2"}\n' ;;
  cognito-idp/admin-get-user)
    if [[ "${AWS_STUB_HUMAN:-false}" == true ]]; then
      printf '{"Username":"subject-human","Enabled":true,"UserStatus":"CONFIRMED","UserAttributes":[{"Name":"email","Value":"developer-one"},{"Name":"sub","Value":"subject-human"}]}\n'
      exit 0
    fi
    if [[ ! -f "$AWS_STUB_STATE" ]]; then
      printf 'UserNotFoundException\n' >&2
      exit 254
    fi
    printf '{"Username":"synthetic-worker","Enabled":true,"UserStatus":"CONFIRMED","UserAttributes":[{"Name":"email","Value":"synthetic-worker@synthetic.crewsafe.invalid"},{"Name":"sub","Value":"00000000-0000-0000-0000-000000000001"}]}\n'
    ;;
  cognito-idp/admin-create-user)
    touch "$AWS_STUB_STATE"
    printf '{"User":{"Username":"synthetic-worker","Attributes":[{"Name":"sub","Value":"00000000-0000-0000-0000-000000000001"}]}}\n'
    ;;
  cognito-idp/admin-list-groups-for-user)
    if [[ "${AWS_STUB_HUMAN:-false}" == true ]]; then
      printf '{"Groups":[{"GroupName":"developers"}]}\n'
    elif [[ "${AWS_STUB_NO_GROUP:-false}" == true ]]; then
      printf '{"Groups":[]}\n'
    else
      printf '{"Groups":[{"GroupName":"synthetic-test-users"}]}\n'
    fi
    ;;
  cognito-idp/list-users)
    printf '{"Users":[{"Username":"synthetic-worker","Attributes":[{"Name":"email","Value":"synthetic-worker@synthetic.crewsafe.invalid"},{"Name":"sub","Value":"00000000-0000-0000-0000-000000000001"}]}]}\n'
    ;;
  *) printf '{}\n' ;;
esac
STUB
chmod +x "$stub"

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
    "groups":["developers","synthetic-test-users"],"application_users":[]
  }}
}'
runner="$TEST_ROOT/.github/scripts/cognito/reconcile-synthetic-users.sh"
common=(
  CREWSAFE_AWS_ACCOUNTS_JSON="$registry"
  CREWSAFE_SHARED_COGNITO_JSON="$shared"
  SYNTHETIC_USERS_FILE="$fixture"
  AWS_CLI="$stub"
  AWS_STUB_LOG="$log"
  AWS_STUB_STATE="$state"
  GITHUB_SHA=1111111111111111111111111111111111111111
  GITHUB_RUN_ID=1234
  GITHUB_ACTOR=actor
)

first="$(
  env "${common[@]}" "$runner" alice reconcile-synthetic demo-worker \
    ap-southeast-1_Example
)"
jq -e '.result == "created-awaiting-binding" and .cognito_sub != null' \
  <<<"$first" >/dev/null || fail "first reconciliation result was unexpected"
assert_no_sensitive_output "$first"

set +e
second="$(
  env "${common[@]}" "$runner" alice reconcile-synthetic demo-worker \
    ap-southeast-1_Example
)"
second_status=$?
set -e
[[ "$second_status" -eq 0 ]] ||
  fail "second reconciliation exited with status $second_status"
jq -e '.result == "created-awaiting-binding"' <<<"$second" >/dev/null ||
  fail "second reconciliation result was unexpected: $second"

if env "${common[@]}" AWS_STUB_NO_GROUP=true "$runner" \
  alice reconcile-synthetic demo-worker ap-southeast-1_Example \
  >/dev/null 2>&1; then
  fail "unbound existing identity without its synthetic group was accepted"
fi

[[ "$(grep -c 'cognito-idp admin-create-user' "$log")" -eq 1 ]] ||
  fail "duplicate Cognito user creation was attempted"
[[ "$(grep -c 'secretsmanager get-random-password' "$log")" -eq 1 ]] ||
  fail "credential was generated during an unchanged reconciliation"
grep -Fq 'cognito-idp admin-create-user' "$log" || fail "create call missing"
grep -Fq 'cognito-idp admin-set-user-password' "$log" || fail "permanent password call missing"
grep -Fq 'cognito-idp admin-add-user-to-group' "$log" || fail "synthetic group call missing"
if grep -Eq 'admin-delete-user|delete-secret|get-secret-value' "$log"; then
  fail "destructive or secret-read API was called"
fi
if grep -Eq 'Generated-[0-9]+-Aa1' "$log"; then
  fail "generated credential appeared in the AWS command log"
fi
grep -Eq -- '--secret-string \[REDACTED\]' "$log" || fail "secret argument was not redacted"
grep -Eq -- '--temporary-password \[REDACTED\]' "$log" || fail "temporary argument was not redacted"
grep -Eq -- '--password \[REDACTED\]' "$log" || fail "password argument was not redacted"

for _ in $(seq 1 100); do
  env "${common[@]}" "$runner" alice reconcile-synthetic demo-worker \
    ap-southeast-1_Example >/dev/null
done
[[ "$(grep -c 'cognito-idp admin-create-user' "$log")" -eq 1 ]]
[[ "$(grep -c 'secretsmanager get-random-password' "$log")" -eq 1 ]]

if env "${common[@]}" "$TEST_ROOT/.github/scripts/cognito/guard-admin-target-kind.sh" \
  ap-southeast-1_Example alice subject-1 reset-password "" >/dev/null 2>&1; then
  fail "generic human operation accepted a live synthetic target"
fi

registry_with_undeclared='{
  "alice":{"account_id":"123456789012","region":"ap-southeast-1"},
  "empty":{"account_id":"210987654321","region":"ap-southeast-1"},
  "bob":{"account_id":"321098765432","region":"ap-southeast-1"}
}'
human="$(
  env "${common[@]}" \
    CREWSAFE_AWS_ACCOUNTS_JSON="$registry_with_undeclared" \
    AWS_STUB_HUMAN=true \
    "$TEST_ROOT/.github/scripts/cognito/guard-admin-target-kind.sh" \
      ap-southeast-1_Example bob subject-human reset-password ""
)"
jq -e '.classification == "human" and .subject == "subject-human"' \
  <<<"$human" >/dev/null ||
  fail "human operation failed safe classification for an account without synthetic declarations"

printf 'Synthetic reconciliation contract: PASS\n'
