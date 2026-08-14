#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/.github/scripts/mobsf-dynamic/evaluate-coverage-signal.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM
TESTS_RUN=0
TESTS_FAILED=0

pass() { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; TESTS_FAILED=$((TESTS_FAILED + 1)); }
expect() {
  local expected="$1" label="$2"
  shift 2
  TESTS_RUN=$((TESTS_RUN + 1))
  local actual=0
  "$@" >/dev/null 2>&1 || actual=$?
  if [[ "$actual" == "$expected" ]]; then pass "$label"; else fail "$label"; fi
}
expect_outcome() {
  local out="$1" expected_outcome="$2" label="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if python3 -c "
import json
d = json.load(open('$out'))
assert d['outcome'] == '$expected_outcome', d
" 2>/dev/null; then
    pass "$label"
  else
    fail "$label"
  fi
}

printf 'test-evaluate-coverage-signal\n'

maestro_passed="$WORK/maestro-passed.json"
echo '{"all_steps_passed": true}' >"$maestro_passed"
maestro_failed="$WORK/maestro-failed.json"
echo '{"all_steps_passed": false}' >"$maestro_failed"

report_with_findings="$WORK/report-with-findings.json"
echo '{"findings": [{"severity": "medium"}, {"severity": "low"}]}' >"$report_with_findings"
report_zero_findings="$WORK/report-zero-findings.json"
echo '{"findings": []}' >"$report_zero_findings"

# --- All steps passed + findings present -> pass ---
out1="$WORK/out1.json"
expect 0 'exits 0 when all steps passed and findings are present' "$SCRIPT" "$maestro_passed" "$report_with_findings" "$out1"
expect_outcome "$out1" 'pass' 'reports outcome=pass when all steps passed and findings are present'

# --- All steps passed + zero findings -> still pass (coverage evidence present) ---
out2="$WORK/out2.json"
expect 0 'exits 0 when all steps passed and zero findings (genuine clean scan)' "$SCRIPT" "$maestro_passed" "$report_zero_findings" "$out2"
expect_outcome "$out2" 'pass' 'reports outcome=pass for a genuinely clean, fully-exercised scan'

# --- Zero findings + Maestro did NOT complete -> no-coverage-evidence, non-zero exit ---
out3="$WORK/out3.json"
expect 1 'exits non-zero when zero findings AND Maestro did not complete all steps' "$SCRIPT" "$maestro_failed" "$report_zero_findings" "$out3"
expect_outcome "$out3" 'no-coverage-evidence' 'reports outcome=no-coverage-evidence (never a false clean pass)'

# --- Findings present but Maestro did NOT complete -> still no-coverage-evidence (the run
#     itself is untrustworthy regardless of what MobSF happened to report) ---
out3b="$WORK/out3b.json"
expect 1 'exits non-zero when Maestro did not complete, even with findings present' "$SCRIPT" "$maestro_failed" "$report_with_findings" "$out3b"
expect_outcome "$out3b" 'no-coverage-evidence' 'reports outcome=no-coverage-evidence when Maestro did not complete, regardless of findings'

# --- Malformed Maestro result -> tooling-failure, non-zero exit ---
malformed_maestro="$WORK/malformed-maestro.json"
printf 'not json' >"$malformed_maestro"
out4="$WORK/out4.json"
expect 1 'exits non-zero when the Maestro result is malformed' "$SCRIPT" "$malformed_maestro" "$report_zero_findings" "$out4"
expect_outcome "$out4" 'tooling-failure' 'reports outcome=tooling-failure for a malformed Maestro result'

# --- Malformed MobSF report -> tooling-failure, non-zero exit ---
malformed_report="$WORK/malformed-report.json"
printf 'not json' >"$malformed_report"
out5="$WORK/out5.json"
expect 1 'exits non-zero when the MobSF report is malformed' "$SCRIPT" "$maestro_passed" "$malformed_report" "$out5"
expect_outcome "$out5" 'tooling-failure' 'reports outcome=tooling-failure for a malformed MobSF report'

# --- Missing input files fail closed ---
expect 1 'exits non-zero when the Maestro result file is missing' "$SCRIPT" "$WORK/no-such-maestro.json" "$report_zero_findings" "$WORK/out6.json"
expect 1 'exits non-zero when the MobSF report file is missing' "$SCRIPT" "$maestro_passed" "$WORK/no-such-report.json" "$WORK/out7.json"

printf '\n%d run, %d failed\n' "$TESTS_RUN" "$TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]
