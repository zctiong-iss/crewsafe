#!/usr/bin/env bash
set -euo pipefail

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/harness.sh"

SCRIPT="$REPO_ROOT/.github/scripts/security/configure-sonar-gate.sh"
FIXTURES="$REPO_ROOT/.github/scripts/tests/fixtures/sonar-gate-configure"

printf 'test-sonar-gate-configure\n'
require_executable "$SCRIPT" "Sonar Quality Gate configurator"

work="$(make_tmpdir)"
mock_bin="$work/bin"
mkdir -p "$mock_bin"
ln -s "$FIXTURES/stub-curl.sh" "$mock_bin/curl"

# run_configure <output-file> [script-args...]
# Env for the run is whatever the caller exported beforehand via `envs=(...)`.
run_configure() {
  local output="$1"
  shift
  : >"$work/calls.log"
  env "${envs[@]}" PATH="$mock_bin:$PATH" MOCK_CALL_LOG="$work/calls.log" \
    "$SCRIPT" "$@" >"$output" 2>&1
}

mutating_call_count() {
  grep -cE '^method=(POST|PATCH)$' "$work/calls.log" 2>/dev/null || true
}

# SonarQube Cloud is multi-tenant: nearly every qualitygates/new_code_periods
# call 400s without an explicit `organization` (discovered against the real
# API, not just the mock -- see the get_by_project fix). Guards against that
# regressing silently behind a mock that never enforced it either.
sonar_calls_missing_organization() {
  awk 'BEGIN{RS="curl\n"} /sonarcloud\.io/ && !/organization=/ {c++} END{print c+0}' "$1"
}

# assert_count <expected> <label> <actual>
assert_count() {
  local expected="$1" label="$2" actual="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ "$actual" == "$expected" ]]; then
    _pass "$label"
  else
    _fail "$label" "expected $expected, got $actual"
  fi
}

# --- User Story 1 (T007): Acceptance Scenarios 1-4 --------------------------
# Every scenario pairs an assertion on MOCK_CALL_LOG/API behavior with an
# assertion on the script's own Run Report stdout (FR-009/SC-005), and checks
# FR-010's guard (no coverage/duplication condition ever sent) inline.

out="$work/out"

# AS1: gate absent -> created, all three conditions added, no coverage/dup.
envs=(
  SONAR_ADMIN_TOKEN=t GH_ADMIN_TOKEN=t
  MOCK_GATE_LIST_RESPONSE_FILE="$FIXTURES/gate-list-empty.json"
  MOCK_GATE_CREATE_RESPONSE_FILE="$FIXTURES/gate-create-response.json"
  MOCK_GATE_SHOW_RESPONSE_FILE="$FIXTURES/gate-show-empty.json"
  MOCK_CONDITION_CREATE_RESPONSE_FILE="$FIXTURES/condition-create-response.json"
  MOCK_GATE_BY_PROJECT_RESPONSE_FILE="$FIXTURES/gate-by-project-unassigned.json"
  MOCK_GATE_SELECT_RESPONSE_FILE="$FIXTURES/gate-select-response.json"
  MOCK_NEW_CODE_RESPONSE_FILE="$FIXTURES/new-code-periods-acceptable.json"
  MOCK_REQUIRED_CHECKS_GET_RESPONSE_FILE="$FIXTURES/required-checks-empty.json"
  MOCK_REQUIRED_CHECKS_PATCH_RESPONSE_FILE="$FIXTURES/required-checks-patch-response.json"
)
assert_exit 0 "US1 AS1: absent gate run succeeds" run_configure "$out"
calls="$(cat "$work/calls.log")"
assert_contains "$calls" "url=https://sonarcloud.io/api/qualitygates/create" "US1 AS1: gate is created"
assert_contains "$calls" "metric=new_security_rating" "US1 AS1: security condition added"
assert_contains "$calls" "metric=new_security_hotspots_reviewed" "US1 AS1: hotspots condition added"
assert_contains "$calls" "metric=new_reliability_rating" "US1 AS1: reliability condition added"
assert_not_contains "$calls" "new_coverage" "US1 AS1 (FR-010 guard): no coverage metric ever sent"
assert_not_contains "$calls" "new_duplicated_lines_density" "US1 AS1 (FR-010 guard): no duplication metric ever sent"
assert_contains "$(cat "$out")" "action=gate_created target=CrewSafe Security Gate" "US1 AS1: Run Report logs gate_created"
assert_count "0" "US1 AS1: every SonarQube call includes organization" "$(sonar_calls_missing_organization "$work/calls.log")"

# AS2: gate already converged and assigned -> full no-op, zero mutating calls.
envs=(
  SONAR_ADMIN_TOKEN=t GH_ADMIN_TOKEN=t
  MOCK_GATE_LIST_RESPONSE_FILE="$FIXTURES/gate-list-found.json"
  MOCK_GATE_SHOW_RESPONSE_FILE="$FIXTURES/gate-show-complete.json"
  MOCK_GATE_BY_PROJECT_RESPONSE_FILE="$FIXTURES/gate-by-project-assigned.json"
  MOCK_NEW_CODE_RESPONSE_FILE="$FIXTURES/new-code-periods-acceptable.json"
  MOCK_REQUIRED_CHECKS_GET_RESPONSE_FILE="$FIXTURES/required-checks-complete.json"
)
assert_exit 0 "US1 AS2: converged re-run succeeds" run_configure "$out"
assert_count "0" "US1 AS2: zero mutating calls" "$(mutating_call_count)"
out_content="$(cat "$out")"
assert_contains "$out_content" "action=no_op target=CrewSafe Security Gate" "US1 AS2: gate side logs no_op"
assert_contains "$out_content" "action=no_op target=required_status_checks.contexts" "US1 AS2: checks side logs no_op"
assert_not_contains "$out_content" "action=condition_added" "US1 AS2: no condition_added on a true no-op"
assert_not_contains "$out_content" "action=condition_updated" "US1 AS2: no condition_updated on a true no-op"

# AS3: one condition missing -> only that one is added, others untouched.
envs=(
  SONAR_ADMIN_TOKEN=t GH_ADMIN_TOKEN=t
  MOCK_GATE_LIST_RESPONSE_FILE="$FIXTURES/gate-list-found.json"
  MOCK_GATE_SHOW_RESPONSE_FILE="$FIXTURES/gate-show-missing-condition.json"
  MOCK_CONDITION_CREATE_RESPONSE_FILE="$FIXTURES/condition-create-response.json"
  MOCK_GATE_BY_PROJECT_RESPONSE_FILE="$FIXTURES/gate-by-project-assigned.json"
  MOCK_NEW_CODE_RESPONSE_FILE="$FIXTURES/new-code-periods-acceptable.json"
  MOCK_REQUIRED_CHECKS_GET_RESPONSE_FILE="$FIXTURES/required-checks-complete.json"
)
assert_exit 0 "US1 AS3: missing-condition drift run succeeds" run_configure "$out"
calls="$(cat "$work/calls.log")"
create_condition_calls="$(grep -c 'url=.*create_condition' "$work/calls.log" || true)"
assert_count "1" "US1 AS3: exactly one condition added" "$create_condition_calls"
assert_contains "$calls" "metric=new_security_hotspots_reviewed" "US1 AS3: the missing metric is the one added"
assert_not_contains "$calls" "update_condition" "US1 AS3: no update call for already-matching conditions"
assert_not_contains "$calls" "new_coverage" "US1 AS3 (FR-010 guard): no coverage metric sent"
assert_contains "$(cat "$out")" "action=condition_added target=new_security_hotspots_reviewed" "US1 AS3: Run Report logs condition_added"

# AS4: one condition drifted (wrong threshold) -> overwritten to declared value.
envs=(
  SONAR_ADMIN_TOKEN=t GH_ADMIN_TOKEN=t
  MOCK_GATE_LIST_RESPONSE_FILE="$FIXTURES/gate-list-found.json"
  MOCK_GATE_SHOW_RESPONSE_FILE="$FIXTURES/gate-show-drifted-condition.json"
  MOCK_CONDITION_UPDATE_RESPONSE_FILE="$FIXTURES/condition-update-response.json"
  MOCK_GATE_BY_PROJECT_RESPONSE_FILE="$FIXTURES/gate-by-project-assigned.json"
  MOCK_NEW_CODE_RESPONSE_FILE="$FIXTURES/new-code-periods-acceptable.json"
  MOCK_REQUIRED_CHECKS_GET_RESPONSE_FILE="$FIXTURES/required-checks-complete.json"
)
assert_exit 0 "US1 AS4: drifted-threshold run succeeds" run_configure "$out"
calls="$(cat "$work/calls.log")"
assert_contains "$calls" "url=https://sonarcloud.io/api/qualitygates/update_condition" "US1 AS4: update_condition is called"
assert_contains "$calls" "metric=new_security_rating&op=GT&error=3" "US1 AS4: overwritten to the declared value (error=3, not the drifted 1)"
assert_not_contains "$calls" "create_condition" "US1 AS4: drift is an update, not a duplicate create"
assert_contains "$(cat "$out")" "action=condition_updated target=new_security_rating" "US1 AS4: Run Report logs condition_updated"
assert_count "0" "US1 AS4: update_condition call includes organization" "$(sonar_calls_missing_organization "$work/calls.log")"

# --- SCRUM-269 (T017): fourth declared condition, new_sca_rating_vulnerability

# SCA condition absent -> created with the declared GT 3 value.
envs=(
  SONAR_ADMIN_TOKEN=t GH_ADMIN_TOKEN=t
  MOCK_GATE_LIST_RESPONSE_FILE="$FIXTURES/gate-list-found.json"
  MOCK_GATE_SHOW_RESPONSE_FILE="$FIXTURES/gate-show-missing-sca-condition.json"
  MOCK_CONDITION_CREATE_RESPONSE_FILE="$FIXTURES/condition-create-sca-response.json"
  MOCK_GATE_BY_PROJECT_RESPONSE_FILE="$FIXTURES/gate-by-project-assigned.json"
  MOCK_NEW_CODE_RESPONSE_FILE="$FIXTURES/new-code-periods-acceptable.json"
  MOCK_REQUIRED_CHECKS_GET_RESPONSE_FILE="$FIXTURES/required-checks-complete.json"
)
assert_exit 0 "SCRUM-269: SCA condition absent -> run succeeds" run_configure "$out"
calls="$(cat "$work/calls.log")"
assert_contains "$calls" "metric=new_sca_rating_vulnerability&op=GT&error=3" "SCRUM-269: SCA condition created with declared GT 3"
assert_contains "$(cat "$out")" "action=condition_added target=new_sca_rating_vulnerability" "SCRUM-269: Run Report logs condition_added for the SCA metric"

# SCA condition already converged, alongside the other three -> full no-op.
envs=(
  SONAR_ADMIN_TOKEN=t GH_ADMIN_TOKEN=t
  MOCK_GATE_LIST_RESPONSE_FILE="$FIXTURES/gate-list-found.json"
  MOCK_GATE_SHOW_RESPONSE_FILE="$FIXTURES/gate-show-complete-with-sca.json"
  MOCK_GATE_BY_PROJECT_RESPONSE_FILE="$FIXTURES/gate-by-project-assigned.json"
  MOCK_NEW_CODE_RESPONSE_FILE="$FIXTURES/new-code-periods-acceptable.json"
  MOCK_REQUIRED_CHECKS_GET_RESPONSE_FILE="$FIXTURES/required-checks-complete.json"
)
assert_exit 0 "SCRUM-269: SCA condition already converged -> run succeeds" run_configure "$out"
assert_count "0" "SCRUM-269: all four conditions converged -> zero mutating calls" "$(mutating_call_count)"

# SCA condition drifted (wrong threshold) -> overwritten to declared value,
# mirroring US1 AS4's coverage for the classic three conditions (analysis
# finding F1).
envs=(
  SONAR_ADMIN_TOKEN=t GH_ADMIN_TOKEN=t
  MOCK_GATE_LIST_RESPONSE_FILE="$FIXTURES/gate-list-found.json"
  MOCK_GATE_SHOW_RESPONSE_FILE="$FIXTURES/gate-show-drifted-sca-condition.json"
  MOCK_CONDITION_UPDATE_RESPONSE_FILE="$FIXTURES/condition-update-sca-response.json"
  MOCK_GATE_BY_PROJECT_RESPONSE_FILE="$FIXTURES/gate-by-project-assigned.json"
  MOCK_NEW_CODE_RESPONSE_FILE="$FIXTURES/new-code-periods-acceptable.json"
  MOCK_REQUIRED_CHECKS_GET_RESPONSE_FILE="$FIXTURES/required-checks-complete.json"
)
assert_exit 0 "SCRUM-269: SCA condition drifted -> run succeeds" run_configure "$out"
calls="$(cat "$work/calls.log")"
assert_contains "$calls" "url=https://sonarcloud.io/api/qualitygates/update_condition" "SCRUM-269: drifted SCA condition triggers update_condition"
assert_contains "$calls" "metric=new_sca_rating_vulnerability&op=GT&error=3" "SCRUM-269: overwritten to declared GT 3 (not the drifted 1)"
assert_not_contains "$calls" "create_condition" "SCRUM-269: drift is an update, not a duplicate create"
assert_contains "$(cat "$out")" "action=condition_updated target=new_sca_rating_vulnerability" "SCRUM-269: Run Report logs condition_updated for the SCA metric"

# Extended FR-010 guard (research.md R1): the payload must never target
# Overall Code (sca_rating_vulnerability, missing the new_ prefix) or the
# rejected severity-aggregate metric family.
assert_not_contains "$calls" "metric=sca_rating_vulnerability&" "SCRUM-269 (guard): never targets Overall Code sca_rating_vulnerability"
assert_not_contains "$calls" "new_sca_severity_vulnerability" "SCRUM-269 (guard): never sends the rejected severity-aggregate metric"

# --- User Story 1 (T008): New Code definition validate-and-warn -------------

envs=(
  SONAR_ADMIN_TOKEN=t GH_ADMIN_TOKEN=t
  MOCK_GATE_LIST_RESPONSE_FILE="$FIXTURES/gate-list-found.json"
  MOCK_GATE_SHOW_RESPONSE_FILE="$FIXTURES/gate-show-complete.json"
  MOCK_GATE_BY_PROJECT_RESPONSE_FILE="$FIXTURES/gate-by-project-assigned.json"
  MOCK_NEW_CODE_RESPONSE_FILE="$FIXTURES/new-code-periods-acceptable.json"
  MOCK_REQUIRED_CHECKS_GET_RESPONSE_FILE="$FIXTURES/required-checks-complete.json"
)
assert_exit 0 "New Code (acceptable): run succeeds" run_configure "$out"
assert_not_contains "$(cat "$out")" "new_code_definition_warning" "New Code (acceptable): no warning logged"

envs=(
  SONAR_ADMIN_TOKEN=t GH_ADMIN_TOKEN=t
  MOCK_GATE_LIST_RESPONSE_FILE="$FIXTURES/gate-list-found.json"
  MOCK_GATE_SHOW_RESPONSE_FILE="$FIXTURES/gate-show-complete.json"
  MOCK_GATE_BY_PROJECT_RESPONSE_FILE="$FIXTURES/gate-by-project-assigned.json"
  MOCK_NEW_CODE_RESPONSE_FILE="$FIXTURES/new-code-periods-unacceptable.json"
  MOCK_REQUIRED_CHECKS_GET_RESPONSE_FILE="$FIXTURES/required-checks-complete.json"
)
assert_exit 0 "New Code (unacceptable): run still completes (non-fatal)" run_configure "$out"
out_content="$(cat "$out")"
assert_contains "$out_content" "new_code_definition_warning target=REFERENCE_BRANCH" "New Code (unacceptable): warning is logged"
assert_contains "$out_content" "action=no_op target=required_status_checks.contexts" "New Code (unacceptable): run continues past the warning"

# New Code endpoint not exposed on this SonarQube instance (observed live
# against real SonarQube Cloud as a 404 "Unknown url" on both /list and
# /show) -- degrades to a skipped warning rather than failing the whole run.
envs=(
  SONAR_ADMIN_TOKEN=t GH_ADMIN_TOKEN=t
  MOCK_GATE_LIST_RESPONSE_FILE="$FIXTURES/gate-list-found.json"
  MOCK_GATE_SHOW_RESPONSE_FILE="$FIXTURES/gate-show-complete.json"
  MOCK_GATE_BY_PROJECT_RESPONSE_FILE="$FIXTURES/gate-by-project-assigned.json"
  MOCK_NEW_CODE_RESPONSE_FILE="$FIXTURES/new-code-periods-not-found.json"
  MOCK_NEW_CODE_HTTP_STATUS=404
  MOCK_REQUIRED_CHECKS_GET_RESPONSE_FILE="$FIXTURES/required-checks-complete.json"
)
assert_exit 0 "New Code (endpoint 404): run still completes (non-fatal)" run_configure "$out"
out_content="$(cat "$out")"
assert_contains "$out_content" "new_code_definition_check_unavailable" "New Code (endpoint 404): distinct unavailable warning is logged"
assert_not_contains "$out_content" "new_code_definition_warning target=" "New Code (endpoint 404): not conflated with the wrong-value warning"
assert_contains "$out_content" "action=no_op target=required_status_checks.contexts" "New Code (endpoint 404): run continues past the warning"

# --- User Story 2 (T015): Acceptance Scenarios 1-3 ---------------------------

# AS1: empty contexts -> all three added, strict preserved.
envs=(
  SONAR_ADMIN_TOKEN=t GH_ADMIN_TOKEN=t
  MOCK_GATE_LIST_RESPONSE_FILE="$FIXTURES/gate-list-found.json"
  MOCK_GATE_SHOW_RESPONSE_FILE="$FIXTURES/gate-show-complete.json"
  MOCK_GATE_BY_PROJECT_RESPONSE_FILE="$FIXTURES/gate-by-project-assigned.json"
  MOCK_NEW_CODE_RESPONSE_FILE="$FIXTURES/new-code-periods-acceptable.json"
  MOCK_REQUIRED_CHECKS_GET_RESPONSE_FILE="$FIXTURES/required-checks-empty.json"
  MOCK_REQUIRED_CHECKS_PATCH_RESPONSE_FILE="$FIXTURES/required-checks-patch-response.json"
)
assert_exit 0 "US2 AS1: empty contexts run succeeds" run_configure "$out"
calls="$(cat "$work/calls.log")"
assert_contains "$calls" "Secret Scan" "US2 AS1: Secret Scan added"
assert_contains "$calls" "SAST (SonarQube)" "US2 AS1: SAST (SonarQube) added"
assert_contains "$calls" "Gate Self-Tests" "US2 AS1: Gate Self-Tests added"
assert_contains "$calls" '"strict": true' "US2 AS1: strict is preserved in the PATCH body"
assert_contains "$(cat "$out")" "action=required_checks_patched" "US2 AS1: Run Report logs required_checks_patched"

# AS2: partial with an unrelated check -> unrelated preserved, two added.
envs=(
  SONAR_ADMIN_TOKEN=t GH_ADMIN_TOKEN=t
  MOCK_GATE_LIST_RESPONSE_FILE="$FIXTURES/gate-list-found.json"
  MOCK_GATE_SHOW_RESPONSE_FILE="$FIXTURES/gate-show-complete.json"
  MOCK_GATE_BY_PROJECT_RESPONSE_FILE="$FIXTURES/gate-by-project-assigned.json"
  MOCK_NEW_CODE_RESPONSE_FILE="$FIXTURES/new-code-periods-acceptable.json"
  MOCK_REQUIRED_CHECKS_GET_RESPONSE_FILE="$FIXTURES/required-checks-partial-with-unrelated.json"
  MOCK_REQUIRED_CHECKS_PATCH_RESPONSE_FILE="$FIXTURES/required-checks-patch-response.json"
)
assert_exit 0 "US2 AS2: partial-with-unrelated run succeeds" run_configure "$out"
calls="$(cat "$work/calls.log")"
assert_contains "$calls" "Some Other Check" "US2 AS2: unrelated check name is preserved"
assert_contains "$calls" "Secret Scan" "US2 AS2: missing Secret Scan is added"
assert_contains "$calls" "Gate Self-Tests" "US2 AS2: missing Gate Self-Tests is added"

# AS3: already complete -> no-op, zero mutating calls for this half.
envs=(
  SONAR_ADMIN_TOKEN=t GH_ADMIN_TOKEN=t
  MOCK_GATE_LIST_RESPONSE_FILE="$FIXTURES/gate-list-found.json"
  MOCK_GATE_SHOW_RESPONSE_FILE="$FIXTURES/gate-show-complete.json"
  MOCK_GATE_BY_PROJECT_RESPONSE_FILE="$FIXTURES/gate-by-project-assigned.json"
  MOCK_NEW_CODE_RESPONSE_FILE="$FIXTURES/new-code-periods-acceptable.json"
  MOCK_REQUIRED_CHECKS_GET_RESPONSE_FILE="$FIXTURES/required-checks-complete.json"
)
assert_exit 0 "US2 AS3: already-complete run succeeds" run_configure "$out"
patch_calls="$(grep -c '^method=PATCH$' "$work/calls.log" || true)"
assert_count "0" "US2 AS3: zero PATCH calls" "$patch_calls"
assert_contains "$(cat "$out")" "action=no_op target=required_status_checks.contexts" "US2 AS3: Run Report logs no_op"

# --- User Story 3 (T020): fail closed on missing/insufficiently-scoped -------

# SONAR_ADMIN_TOKEN unset entirely.
envs=(GH_ADMIN_TOKEN=t)
assert_exit 1 "US3: missing SONAR_ADMIN_TOKEN fails" run_configure "$out"
assert_contains "$(cat "$out")" "SONAR_ADMIN_TOKEN is not set" "US3: error names the missing var"
calls_size="$( [[ -s "$work/calls.log" ]] && echo nonempty || echo empty )"
assert_count "empty" "US3: missing SONAR_ADMIN_TOKEN makes zero calls" "$calls_size"

# SONAR_ADMIN_TOKEN present but insufficiently scoped (403 on first call).
envs=(
  SONAR_ADMIN_TOKEN=t GH_ADMIN_TOKEN=t
  MOCK_SONAR_HTTP_STATUS=403
  MOCK_GATE_LIST_RESPONSE_FILE="$FIXTURES/sonar-403-insufficient-scope.json"
)
assert_exit 1 "US3: insufficiently-scoped SONAR_ADMIN_TOKEN fails" run_configure "$out"
out_content="$(cat "$out")"
assert_contains "$out_content" "SONAR_ADMIN_TOKEN is present but insufficiently scoped" "US3: error distinguishes insufficient scope from missing"
assert_not_contains "$out_content" "SONAR_ADMIN_TOKEN is not set" "US3: insufficient-scope wording differs from the missing-var wording"
call_count="$(grep -c '^curl$' "$work/calls.log" || true)"
assert_count "1" "US3: exactly one call before failing on 403" "$call_count"

# GH_ADMIN_TOKEN unset -- SonarQube half completes first (per FR-006 sequencing).
envs=(
  SONAR_ADMIN_TOKEN=t
  MOCK_GATE_LIST_RESPONSE_FILE="$FIXTURES/gate-list-found.json"
  MOCK_GATE_SHOW_RESPONSE_FILE="$FIXTURES/gate-show-complete.json"
  MOCK_GATE_BY_PROJECT_RESPONSE_FILE="$FIXTURES/gate-by-project-assigned.json"
  MOCK_NEW_CODE_RESPONSE_FILE="$FIXTURES/new-code-periods-acceptable.json"
)
assert_exit 1 "US3: missing GH_ADMIN_TOKEN fails after SonarQube half completes" run_configure "$out"
out_content="$(cat "$out")"
assert_contains "$out_content" "GH_ADMIN_TOKEN is not set" "US3: error names the missing var"
assert_contains "$out_content" "action=no_op target=CrewSafe Security Gate" "US3: SonarQube half still completed and logged"
assert_not_contains "$(cat "$work/calls.log")" "api.github.com" "US3: missing GH_ADMIN_TOKEN makes zero GitHub calls"

# GH_ADMIN_TOKEN present but insufficiently scoped (403 on the GET).
envs=(
  SONAR_ADMIN_TOKEN=t GH_ADMIN_TOKEN=t
  MOCK_GATE_LIST_RESPONSE_FILE="$FIXTURES/gate-list-found.json"
  MOCK_GATE_SHOW_RESPONSE_FILE="$FIXTURES/gate-show-complete.json"
  MOCK_GATE_BY_PROJECT_RESPONSE_FILE="$FIXTURES/gate-by-project-assigned.json"
  MOCK_NEW_CODE_RESPONSE_FILE="$FIXTURES/new-code-periods-acceptable.json"
  MOCK_GITHUB_HTTP_STATUS=403
  MOCK_REQUIRED_CHECKS_GET_RESPONSE_FILE="$FIXTURES/github-403-insufficient-scope.json"
)
assert_exit 1 "US3: insufficiently-scoped GH_ADMIN_TOKEN fails" run_configure "$out"
out_content="$(cat "$out")"
assert_contains "$out_content" "GH_ADMIN_TOKEN is present but insufficiently scoped" "US3: error distinguishes insufficient scope from missing"
patch_calls="$(grep -c '^method=PATCH$' "$work/calls.log" || true)"
assert_count "0" "US3: no PATCH call, not even a partial one, after a 403 on GET" "$patch_calls"

# --- T013/T018: --dry-run makes zero mutating calls on either half (FR-007) -

envs=(
  SONAR_ADMIN_TOKEN=t GH_ADMIN_TOKEN=t
  MOCK_GATE_LIST_RESPONSE_FILE="$FIXTURES/gate-list-empty.json"
  MOCK_GATE_BY_PROJECT_RESPONSE_FILE="$FIXTURES/gate-by-project-unassigned.json"
  MOCK_NEW_CODE_RESPONSE_FILE="$FIXTURES/new-code-periods-acceptable.json"
  MOCK_REQUIRED_CHECKS_GET_RESPONSE_FILE="$FIXTURES/required-checks-empty.json"
)
assert_exit 0 "--dry-run: fresh-gate run succeeds" run_configure "$out" --dry-run
assert_count "0" "--dry-run: zero mutating calls" "$(mutating_call_count)"
out_content="$(cat "$out")"
assert_contains "$out_content" "action=gate_created target=CrewSafe Security Gate mode=dry_run" "--dry-run: reports the gate it would create"
assert_contains "$out_content" "action=condition_added target=new_security_rating mode=dry_run" "--dry-run: reports conditions it would add"
assert_contains "$out_content" "action=required_checks_patched target=required_status_checks.contexts mode=dry_run" "--dry-run: reports the checks patch it would make"

# --- Polish (T026): tokens never appear in the script's own output ----------

envs=(
  SONAR_ADMIN_TOKEN=SUPER_SECRET_SONAR_TOKEN_XYZ GH_ADMIN_TOKEN=SUPER_SECRET_GH_TOKEN_XYZ
  MOCK_GATE_LIST_RESPONSE_FILE="$FIXTURES/gate-list-empty.json"
  MOCK_GATE_CREATE_RESPONSE_FILE="$FIXTURES/gate-create-response.json"
  MOCK_GATE_SHOW_RESPONSE_FILE="$FIXTURES/gate-show-empty.json"
  MOCK_CONDITION_CREATE_RESPONSE_FILE="$FIXTURES/condition-create-response.json"
  MOCK_GATE_BY_PROJECT_RESPONSE_FILE="$FIXTURES/gate-by-project-unassigned.json"
  MOCK_GATE_SELECT_RESPONSE_FILE="$FIXTURES/gate-select-response.json"
  MOCK_NEW_CODE_RESPONSE_FILE="$FIXTURES/new-code-periods-acceptable.json"
  MOCK_REQUIRED_CHECKS_GET_RESPONSE_FILE="$FIXTURES/required-checks-empty.json"
  MOCK_REQUIRED_CHECKS_PATCH_RESPONSE_FILE="$FIXTURES/required-checks-patch-response.json"
)
assert_exit 0 "SEC-003: full successful run for the token-leak check" run_configure "$out"
assert_not_contains "$(cat "$out")" "SUPER_SECRET_SONAR_TOKEN_XYZ" "SEC-003: SonarQube token never appears in output"
assert_not_contains "$(cat "$out")" "SUPER_SECRET_GH_TOKEN_XYZ" "SEC-003: GitHub token never appears in output"
assert_not_contains "$(cat "$work/calls.log")" "SUPER_SECRET" "SEC-003: neither token appears in the mock's call log"

finish
