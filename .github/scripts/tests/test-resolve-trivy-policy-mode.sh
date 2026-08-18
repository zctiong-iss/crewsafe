#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/.github/scripts/security/resolve-trivy-policy-mode.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM
TESTS_RUN=0
TESTS_FAILED=0

pass() { local label="$1"; printf '  ok   %s\n' "$label"; }
fail() { local label="$1"; printf '  FAIL %s\n' "$label"; TESTS_FAILED=$((TESTS_FAILED + 1)); }

assert_exit() {
  local expected="$1" label="$2" output_file="$3"
  shift 3
  TESTS_RUN=$((TESTS_RUN + 1))
  local actual=0
  "$@" >"$output_file" 2>&1 || actual=$?
  if [[ "$actual" == "$expected" ]]; then pass "$label"; else fail "$label"; fi
}

assert_output_contains() {
  local output_file="$1" needle="$2" label="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if rg -q -F -- "$needle" "$output_file"; then pass "$label"; else fail "$label"; fi
}

assert_output_not_contains() {
  local output_file="$1" needle="$2" label="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if ! rg -q -F -- "$needle" "$output_file"; then pass "$label"; else fail "$label"; fi
}

run_to_outputs() {
  local output_file="$1"
  shift
  GITHUB_OUTPUT="$output_file" "$SCRIPT" "$@"
}

printf 'test-resolve-trivy-policy-mode\n'

TESTS_RUN=$((TESTS_RUN + 1))
if [[ -x "$SCRIPT" ]]; then pass 'policy helper exists and is executable'; else fail 'policy helper exists and is executable'; fi

before="$WORK/before.out"
assert_exit 0 'day before expiry is report-only' "$WORK/before.log" run_to_outputs "$before" --as-of 2026-09-16
assert_output_contains "$before" 'mode=report-only' 'before-expiry mode is report-only'
assert_output_contains "$before" 'exit_code=0' 'before-expiry exit code is zero'
assert_output_contains "$before" 'owner=CrewSafe security team' 'policy owner is emitted'
assert_output_contains "$before" 'expires=2026-09-17' 'policy expiry is emitted'
assert_output_contains "$before" 'evaluated_on=2026-09-16' 'evaluated date is emitted'

on_expiry="$WORK/on-expiry.out"
assert_exit 0 'expiry date remains report-only' "$WORK/on-expiry.log" run_to_outputs "$on_expiry" --as-of 2026-09-17
assert_output_contains "$on_expiry" 'mode=report-only' 'expiry-day mode is report-only'
assert_output_contains "$on_expiry" 'exit_code=0' 'expiry-day exit code is zero'

after="$WORK/after.out"
assert_exit 0 'day after expiry resolves blocking without failing helper' "$WORK/after.log" run_to_outputs "$after" --as-of 2026-09-18
assert_output_contains "$after" 'mode=blocking' 'post-expiry mode is blocking'
assert_output_contains "$after" 'exit_code=1' 'post-expiry exit code is one'

production="$WORK/production.out"
assert_exit 0 'production no-argument invocation succeeds' "$WORK/production.log" run_to_outputs "$production"
assert_output_contains "$production" 'evaluated_on=' 'production invocation emits a UTC evaluated date'
assert_output_contains "$production" 'owner=CrewSafe security team' 'production invocation emits policy owner'

invalid_date="$WORK/invalid-date.out"
assert_exit 1 'invalid as-of date fails closed' "$invalid_date" run_to_outputs "$WORK/invalid-date.outputs" --as-of 2026-02-30
assert_output_not_contains "$invalid_date" 'mode=' 'invalid date emits no policy mode'

missing_value="$WORK/missing-value.out"
assert_exit 1 'missing as-of value fails closed' "$missing_value" run_to_outputs "$WORK/missing-value.outputs" --as-of

extra_arg="$WORK/extra-arg.out"
assert_exit 1 'additional policy arguments fail closed' "$extra_arg" run_to_outputs "$WORK/extra-arg.outputs" --as-of 2026-09-17 extra

printf '%s tests, %s failed\n' "$TESTS_RUN" "$TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]
