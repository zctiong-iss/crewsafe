#!/usr/bin/env bash
set -euo pipefail

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/harness.sh"

SCRIPT="$REPO_ROOT/.github/scripts/security/check-sca-active.sh"
FIXTURES="$REPO_ROOT/.github/scripts/tests/fixtures/sca-exceptions"

printf 'test-check-sca-active\n'
require_executable "$SCRIPT" "SCA-active verifier"

work="$(make_tmpdir)"
mock_bin="$work/bin"
mkdir -p "$mock_bin"
ln -s "$REPO_ROOT/.github/scripts/tests/fixtures/sonar-gate-configure/stub-curl.sh" "$mock_bin/curl"

run_check() {
  local output="$1"
  shift
  : >"$work/calls.log"
  # ${envs[@]+"${envs[@]}"} -- safe expansion of a possibly-EMPTY array under
  # `set -u` on bash 3.2 (this repo's documented macOS constraint,
  # harness.sh's own `in_dir` comment): a bare "${envs[@]}" on an empty array
  # raises "unbound variable" there, unlike bash 4.4+.
  env ${envs[@]+"${envs[@]}"} PATH="$mock_bin:$PATH" MOCK_CALL_LOG="$work/calls.log" \
    "$SCRIPT" "$@" >"$output" 2>&1
}

out="$work/out"

# --- FR-003a AS1: SCA active -> exit 0, no error --------------------------
envs=(
  SONAR_TOKEN=t
  MOCK_SCA_MEASURES_RESPONSE_FILE="$FIXTURES/sca-measures-active.json"
)
assert_exit 0 "SCA active: exits 0" run_check "$out"
assert_contains "$(cat "$out")" "sca_active" "SCA active: reports active status"

# --- FR-003a AS2: SCA inactive/absent -> exit 1, fail closed ---------------
envs=(
  SONAR_TOKEN=t
  MOCK_SCA_MEASURES_RESPONSE_FILE="$FIXTURES/sca-measures-inactive.json"
)
assert_exit 1 "SCA inactive: exits 1 (fail closed)" run_check "$out"
assert_contains "$(cat "$out")" "not active" "SCA inactive: names the inactive state"

# --- FR-003a AS3: the API call itself errors -> exit 1, fail closed -------
# (distinct from "inactive" -- an unknown state is treated as unsafe, not as
# a confirmed-inactive one, though both fail closed per Clarifications.)
envs=(
  SONAR_TOKEN=t
  MOCK_SCA_MEASURES_RESPONSE_FILE="$FIXTURES/sca-measures-active.json"
  MOCK_SONAR_HTTP_STATUS=500
)
assert_exit 1 "SCA-active API error: exits 1 (fail closed)" run_check "$out"

# --- FR-006 credential guard, mirrors configure-sonar-gate.sh -------------
envs=()
assert_exit 1 "missing SONAR_TOKEN: exits 1 before any call" run_check "$out"
assert_count() {
  local expected="$1" label="$2" actual="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ "$actual" == "$expected" ]]; then _pass "$label"; else _fail "$label" "expected $expected, got $actual"; fi
}
assert_count "0" "missing token: zero API calls made" \
  "$(grep -cE '^method=' "$work/calls.log" 2>/dev/null || true)"

# --- SEC-003 (analysis finding D1): the token must never leak into output -
envs=(
  SONAR_TOKEN=SUPER_SECRET_SONAR_TOKEN_XYZ
  MOCK_SCA_MEASURES_RESPONSE_FILE="$FIXTURES/sca-measures-active.json"
)
assert_exit 0 "SEC-003: full successful run for the token-leak check" run_check "$out"
assert_not_contains "$(cat "$out")" "SUPER_SECRET_SONAR_TOKEN_XYZ" "SEC-003: SONAR_TOKEN never appears in output"
assert_not_contains "$(cat "$work/calls.log")" "SUPER_SECRET_SONAR_TOKEN_XYZ" "SEC-003: SONAR_TOKEN never appears in the mock's call log"

finish
