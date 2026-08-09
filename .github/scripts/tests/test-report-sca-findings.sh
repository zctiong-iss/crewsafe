#!/usr/bin/env bash
set -euo pipefail

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/harness.sh"

SCRIPT="$REPO_ROOT/.github/scripts/security/report-sca-findings.sh"
FIXTURES="$REPO_ROOT/.github/scripts/tests/fixtures/sca-exceptions"

printf 'test-report-sca-findings\n'
require_executable "$SCRIPT" "SCA findings reporter"

work="$(make_tmpdir)"
mock_bin="$work/bin"
mkdir -p "$mock_bin"
ln -s "$REPO_ROOT/.github/scripts/tests/fixtures/sonar-gate-configure/stub-curl.sh" "$mock_bin/curl"

run_report() {
  local summary_out="$1"
  : >"$work/calls.log"
  env ${envs[@]+"${envs[@]}"} PATH="$mock_bin:$PATH" MOCK_CALL_LOG="$work/calls.log" \
    "$SCRIPT" >"$summary_out" 2>"$work/stderr"
}

summary="$work/summary"

# --- FR-005 AS: findings surfaced to job-summary-style stdout -------------
envs=(
  SONAR_TOKEN=t
  MOCK_DEPENDENCY_RISK_SEARCH_RESPONSE_FILE="$FIXTURES/dependency-risk-search-open.json"
)
assert_exit 0 "findings summary: exits 0" run_report "$summary"
out="$(cat "$summary")"
assert_contains "$out" "org.apache.commons:commons-compress" "summary names the affected package"
assert_contains "$out" "BLOCKER" "summary names the severity"
assert_contains "$out" "CVE-2024-25710" "summary names the CVE"
assert_contains "$out" "1.26.0" "summary includes remediation (recommended version)"

# --- FR-005 Clarifications: fail OPEN on API error, not closed ------------
envs=(
  SONAR_TOKEN=t
  MOCK_DEPENDENCY_RISK_SEARCH_RESPONSE_FILE="$FIXTURES/dependency-risk-search-open.json"
  MOCK_SONAR_HTTP_STATUS=500
)
assert_exit 0 "findings-search API error: still exits 0 (fail open)" run_report "$summary"
assert_contains "$(cat "$work/stderr")" "WARN" "findings-search API error: warns rather than erroring silently"

# --- SEC-003 (analysis finding D1): the token must never leak into output -
envs=(
  SONAR_TOKEN=SUPER_SECRET_SONAR_TOKEN_XYZ
  MOCK_DEPENDENCY_RISK_SEARCH_RESPONSE_FILE="$FIXTURES/dependency-risk-search-open.json"
)
assert_exit 0 "SEC-003: full successful run for the token-leak check" run_report "$summary"
assert_not_contains "$(cat "$summary")" "SUPER_SECRET_SONAR_TOKEN_XYZ" "SEC-003: SONAR_TOKEN never appears in the summary"
assert_not_contains "$(cat "$work/calls.log")" "SUPER_SECRET_SONAR_TOKEN_XYZ" "SEC-003: SONAR_TOKEN never appears in the mock's call log"

finish
