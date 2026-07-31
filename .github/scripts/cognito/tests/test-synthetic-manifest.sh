#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/helpers/synthetic-test-helpers.sh"

registry='{"alice":{"account_id":"123456789012"},"empty":{"account_id":"210987654321"}}'
fixture="$TEST_ROOT/.github/scripts/cognito/tests/fixtures/synthetic/valid.yml"
output="$(
  CREWSAFE_AWS_ACCOUNTS_JSON="$registry" SYNTHETIC_USERS_FILE="$fixture" \
    "$SYNTHETIC_RESOLVER"
)"
jq -e '
  .schema_version == 1
  and .accounts.alice.count == 3
  and .accounts.alice.unbound == 1
  and .accounts.empty.count == 0
  and .omission_policy == "report-only"
' <<<"$output" >/dev/null

selected="$(
  CREWSAFE_AWS_ACCOUNTS_JSON="$registry" SYNTHETIC_USERS_FILE="$fixture" \
    "$SYNTHETIC_RESOLVER" alice demo-worker
)"
jq -e '
  .account_alias == "alice"
  and (.users | length) == 1
  and .users[0].key == "demo-worker"
  and .users[0].cognito_sub == null
' <<<"$selected" >/dev/null
assert_no_sensitive_output "$output"

for invalid in "$TEST_ROOT"/.github/scripts/cognito/tests/fixtures/synthetic-invalid/*.yml; do
  CREWSAFE_AWS_ACCOUNTS_JSON="$registry" assert_rejected "$invalid"
done

unknown_registry='{"empty":{"account_id":"210987654321"}}'
if CREWSAFE_AWS_ACCOUNTS_JSON="$unknown_registry" SYNTHETIC_USERS_FILE="$fixture" \
  "$SYNTHETIC_RESOLVER" >/dev/null 2>&1; then
  fail "unknown manifest account was accepted"
fi

for _ in $(seq 1 20); do
  CREWSAFE_AWS_ACCOUNTS_JSON="$registry" SYNTHETIC_USERS_FILE="$fixture" \
    "$SYNTHETIC_RESOLVER" >/dev/null
done

printf 'Synthetic manifest contract: PASS\n'
