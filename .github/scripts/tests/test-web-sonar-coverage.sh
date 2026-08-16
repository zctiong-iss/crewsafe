#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/security-scan.yml"
SONAR_PROPS="$ROOT/sonar-project.properties"
TESTS_RUN=0
TESTS_FAILED=0
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

pass() { local label="$1"; printf '  ok   %s\n' "$label"; }
fail() { local label="$1"; printf '  FAIL %s\n' "$label"; TESTS_FAILED=$((TESTS_FAILED + 1)); }

check() {
  local label="$1"
  shift
  TESTS_RUN=$((TESTS_RUN + 1))
  if "$@"; then pass "$label"; else fail "$label"; fi
}

contains() { local file="$1" needle="$2"; grep -q -F -- "$needle" "$file"; }

sast_block() {
  local workflow="${1:-$WORKFLOW}"
  awk '/^  sast:/{inside=1} /^  [a-z-]+:/{if ($0 !~ /^  sast:/) inside=0} inside' "$workflow"
}

ordered() {
  local content="$1"
  shift
  local previous=0 current needle
  for needle in "$@"; do
    current="$(awk -v needle="$needle" 'index($0, needle) { print NR; exit }' <<<"$content")"
    [[ -n "$current" && "$current" -gt "$previous" ]] || return 1
    previous="$current"
  done
}

# A normalized web LCOV report is valid only if it is non-empty, contains at least one SF:
# line, and EVERY SF: line is prefixed web/src/ -- a report with one matching line plus an
# out-of-scope line (e.g. web/node_modules/...) must still be rejected (SEC-002 fail-closed).
validate_report() {
  local report="$1"
  [[ -s "$report" ]] || return 1
  local sf_lines out_of_scope
  sf_lines="$(grep -c '^SF:' "$report" || true)"
  [[ "$sf_lines" -gt 0 ]] || return 1
  out_of_scope="$(grep '^SF:' "$report" | grep -vc '^SF:web/src/' || true)"
  [[ "$out_of_scope" -eq 0 ]]
}

reject_report() {
  local report="$1"
  ! validate_report "$report" >/dev/null 2>&1
}

has_read_only_permission() {
  grep -A1 '^permissions:' "$WORKFLOW" | grep -q '^  contents: read$'
}

workflow_contract_holds() {
  local workflow="$1"
  local sast
  sast="$(sast_block "$workflow")"
  grep -A1 '^permissions:' "$workflow" | grep -q '^  contents: read$' || return 1
  contains "$workflow" 'npm run test:coverage' || return 1
  [[ "$sast" == *"Generate web coverage"* ]] || return 1
  [[ "$sast" == *"Prepare web LCOV for SonarQube"* ]] || return 1
  ordered "$sast" \
    'Install web dependencies for analysis' \
    'Generate web coverage' \
    'Prepare web LCOV for SonarQube' \
    'Analyse with SonarQube Cloud'
}

sonar_contract_holds() {
  local properties="$1"
  grep -q '^sonar\.javascript\.lcov\.reportPaths=.*web/coverage/sonar-lcov\.info' "$properties" || return 1
  grep -q '^sonar\.javascript\.lcov\.reportPaths=.*mobile/coverage/sonar-lcov\.info' "$properties" || return 1
  grep -q '^sonar\.sources=.*web/src' "$properties" || return 1
  grep -q '^sonar\.tests=.*web/src' "$properties" || return 1
  grep -q '^sonar\.test\.inclusions=.*\*\*/\*\.test\.tsx' "$properties" || return 1
  grep -q '^sonar\.coverage\.jacoco\.xmlReportPaths=backend/target/site/jacoco/jacoco\.xml$' "$properties" || return 1
  grep -q '^sonar\.python\.coverage\.reportPaths=ml-service/coverage\.xml$' "$properties"
}

reject_workflow_contract() {
  local workflow="$1"
  ! workflow_contract_holds "$workflow"
}

reject_sonar_contract() {
  local properties="$1"
  ! sonar_contract_holds "$properties"
}

printf 'test-web-sonar-coverage\n'

valid_report="$TMP_DIR/valid.info"
cat >"$valid_report" <<'LCOV'
SF:web/src/auth/authConfig.ts
DA:1,1
end_of_record
SF:web/src/api/errors.ts
DA:1,1
end_of_record
LCOV

empty_report="$TMP_DIR/empty.info"
: >"$empty_report"

missing_report="$TMP_DIR/does-not-exist.info"

no_sf_report="$TMP_DIR/no-sf.info"
cat >"$no_sf_report" <<'LCOV'
TN:
end_of_record
LCOV

unprefixed_report="$TMP_DIR/unprefixed.info"
cat >"$unprefixed_report" <<'LCOV'
SF:src/auth/authConfig.ts
DA:1,1
end_of_record
LCOV

out_of_scope_report="$TMP_DIR/out-of-scope.info"
cat >"$out_of_scope_report" <<'LCOV'
SF:web/src/auth/authConfig.ts
DA:1,1
end_of_record
SF:web/node_modules/some-dep/index.js
DA:1,1
end_of_record
LCOV

check 'valid synthetic LCOV report is accepted' validate_report "$valid_report"
check 'empty LCOV report is rejected' reject_report "$empty_report"
check 'missing LCOV report is rejected' reject_report "$missing_report"
check 'LCOV report with no SF: lines is rejected' reject_report "$no_sf_report"
check 'LCOV report with unprefixed SF: lines is rejected' reject_report "$unprefixed_report"
check 'LCOV report with an out-of-scope SF: line is rejected' reject_report "$out_of_scope_report"

check 'security scan workflow exists' test -f "$WORKFLOW"
check 'SonarQube properties exist' test -f "$SONAR_PROPS"

sast_has_step() {
  local needle="$1" sast
  sast="$(sast_block "$WORKFLOW")"
  [[ "$sast" == *"$needle"* ]]
}

if [[ -f "$WORKFLOW" ]]; then
  check 'SAST keeps read-only repository permission' has_read_only_permission
  check 'SAST has a Generate web coverage step' sast_has_step 'Generate web coverage'
  check 'SAST prepares web coverage before scanning in order' workflow_contract_holds "$WORKFLOW"
fi

if [[ -f "$SONAR_PROPS" ]]; then
  check 'web LCOV report path is declared' grep -q '^sonar\.javascript\.lcov\.reportPaths=.*web/coverage/sonar-lcov\.info' "$SONAR_PROPS"
  check 'mobile LCOV report path remains declared' grep -q '^sonar\.javascript\.lcov\.reportPaths=.*mobile/coverage/sonar-lcov\.info' "$SONAR_PROPS"
  check 'complete SonarQube web coverage contract holds' sonar_contract_holds "$SONAR_PROPS"
fi

mutated_workflow="$TMP_DIR/security-scan-without-web-validation.yml"
sed 's/name: Prepare web LCOV for SonarQube/name: Web LCOV validation step removed/' "$WORKFLOW" >"$mutated_workflow"
check 'workflow contract rejects missing web report-validation step' reject_workflow_contract "$mutated_workflow"

mutated_properties_dropped="$TMP_DIR/sonar-without-web-lcov.properties"
sed 's|sonar\.javascript\.lcov\.reportPaths=web/coverage/sonar-lcov\.info,mobile|sonar.javascript.lcov.reportPaths=mobile|' "$SONAR_PROPS" >"$mutated_properties_dropped"
check 'SonarQube contract rejects a dropped web LCOV path (regression to mobile-only)' reject_sonar_contract "$mutated_properties_dropped"

mutated_properties_no_mobile="$TMP_DIR/sonar-without-mobile-lcov.properties"
sed 's|,mobile/coverage/sonar-lcov\.info||' "$SONAR_PROPS" >"$mutated_properties_no_mobile"
check 'SonarQube contract rejects a dropped mobile LCOV path' reject_sonar_contract "$mutated_properties_no_mobile"

printf '%d tests, %d failed\n' "$TESTS_RUN" "$TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]
