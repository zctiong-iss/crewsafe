#!/usr/bin/env bash
set -euo pipefail

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/harness.sh"

SCRIPT="$REPO_ROOT/.github/scripts/security/apply-sca-exceptions.sh"
FIXTURES="$REPO_ROOT/.github/scripts/tests/fixtures/sca-exceptions"

printf 'test-apply-sca-exceptions\n'
require_executable "$SCRIPT" "SCA exception applier"

work="$(make_tmpdir)"
mock_bin="$work/bin"
mkdir -p "$mock_bin"
ln -s "$REPO_ROOT/.github/scripts/tests/fixtures/sonar-gate-configure/stub-curl.sh" "$mock_bin/curl"

run_apply() {
  local exceptions_file="$1"
  : >"$work/calls.log"
  env ${envs[@]+"${envs[@]}"} PATH="$mock_bin:$PATH" MOCK_CALL_LOG="$work/calls.log" \
    "$SCRIPT" "$exceptions_file" >"$work/out" 2>&1
}

future="$(date -u -d '+30 days' +%F 2>/dev/null || date -u -v+30d +%F)"
past="$(date -u -d '-1 day' +%F 2>/dev/null || date -u -v-1d +%F)"

write_exceptions() {
  local dir="$1"
  local f="$dir/sca-exceptions.yml"
  shift
  {
    printf 'exceptions:\n'
    printf '%s\n' "$@"
  } >"$f"
  printf '%s' "$f"
}

# --- T026/T027: non-expired / expired / malformed (no `expires:`) --------
excf="$(write_exceptions "$work" \
  "  - key: 11111111-1111-1111-1111-111111111111" \
  "    reason: \"non-expired, should transition\"" \
  "    expires: ${future}" \
  "  - key: 22222222-2222-2222-2222-222222222222" \
  "    reason: \"expired, must not suppress\"" \
  "    expires: ${past}" \
  "  - key: 33333333-3333-3333-3333-333333333333" \
  "    reason: \"missing expires entirely, must fail closed\"")"

envs=(
  SONAR_ADMIN_TOKEN=t
  MOCK_DEPENDENCY_RISK_TRANSITION_RESPONSE_FILE="$FIXTURES/dependency-risk-transition-response.json"
)
assert_exit 0 "apply exceptions: exits 0 when all transitions succeed" run_apply "$excf"
calls="$(cat "$work/calls.log")"
assert_contains "$calls" "11111111-1111-1111-1111-111111111111" "non-expired entry's key is transitioned"
assert_not_contains "$calls" "22222222-2222-2222-2222-222222222222" "expired entry is never transitioned"
assert_not_contains "$calls" "33333333-3333-3333-3333-333333333333" "malformed (missing expires) entry is never transitioned"

# --- US3 Scenario 2 / T027: the SAME entry excluded once expired ---------
excf2="$(write_exceptions "$work" \
  "  - key: 44444444-4444-4444-4444-444444444444" \
  "    reason: \"now expired\"" \
  "    expires: ${past}")"
run_apply "$excf2"
assert_not_contains "$(cat "$work/calls.log")" "44444444-4444-4444-4444-444444444444" \
  "expired-by-date entry excluded on the next run (expiry-by-exclusion)"

# --- data-model.md: a transition-call error for a LISTED key fails the ---
# --- script -- it is not silently skipped.                              --
excf3="$(write_exceptions "$work" \
  "  - key: 55555555-5555-5555-5555-555555555555" \
  "    reason: \"transition will fail\"" \
  "    expires: ${future}")"
envs=(
  SONAR_ADMIN_TOKEN=t
  MOCK_DEPENDENCY_RISK_TRANSITION_RESPONSE_FILE="$FIXTURES/dependency-risk-transition-response.json"
  MOCK_SONAR_HTTP_STATUS=500
)
assert_exit 1 "transition-call error for a listed key fails the script (not silently skipped)" run_apply "$excf3"

# --- credential guard -----------------------------------------------------
envs=()
assert_exit 1 "missing SONAR_ADMIN_TOKEN: exits 1 before any call" run_apply "$excf"

# --- empty exceptions list: no-op, exit 0 ---------------------------------
empty_excf="$(write_exceptions "$work")"
envs=(SONAR_ADMIN_TOKEN=t)
assert_exit 0 "empty exceptions list: no-op, exits 0" run_apply "$empty_excf"

# --- SEC-003 (analysis finding D1): the token must never leak into output -
envs=(
  SONAR_ADMIN_TOKEN=SUPER_SECRET_SONAR_ADMIN_TOKEN_XYZ
  MOCK_DEPENDENCY_RISK_TRANSITION_RESPONSE_FILE="$FIXTURES/dependency-risk-transition-response.json"
)
assert_exit 0 "SEC-003: full successful run for the token-leak check" run_apply "$excf"
assert_not_contains "$(cat "$work/out")" "SUPER_SECRET_SONAR_ADMIN_TOKEN_XYZ" "SEC-003: SONAR_ADMIN_TOKEN never appears in output"
assert_not_contains "$(cat "$work/calls.log")" "SUPER_SECRET_SONAR_ADMIN_TOKEN_XYZ" "SEC-003: SONAR_ADMIN_TOKEN never appears in the mock's call log"

finish
