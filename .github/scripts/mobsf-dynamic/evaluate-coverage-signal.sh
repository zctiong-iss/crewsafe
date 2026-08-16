#!/usr/bin/env bash
set -euo pipefail

# SCRUM-350. FR-016 / research.md R12: decides whether a Dynamic Scan Run is a genuine pass,
# or must be reported as failed even though MobSF's own report may look well-formed. A report
# with zero findings only counts as a clean pass when Maestro's own step-by-step result
# proves the synthetic flow actually ran end to end (the coverage/liveness signal) --
# otherwise a silently-broken run (e.g. sign-in failing early) would look identical to a
# genuinely clean app. Findings themselves never drive this decision (FR-010: non-blocking on
# findings in this iteration) -- only whether the flow demonstrably executed.
#
# Usage: evaluate-coverage-signal.sh <maestro-result-json> <mobsf-report-json> <output-json>
# <maestro-result-json> must be valid JSON with a boolean `all_steps_passed` field.
# <mobsf-report-json> must be valid JSON (its `.findings` array, if present, is reported for
# evidence only -- it never changes the outcome).
#
# Writes <output-json>: { "outcome": "pass"|"no-coverage-evidence"|"tooling-failure",
# "coverage_evidence": true|false, "findings_count": N }
# Exit 0 only for outcome=pass; non-zero for every other outcome (research.md R12).

usage() {
  echo "usage: $(basename "$0") <maestro-result-json> <mobsf-report-json> <output-json>" >&2
}

write_outcome() {
  local outcome="$1" coverage_evidence="$2" findings_count="$3"
  cat >"$output_path" <<JSON
{
  "outcome": "$outcome",
  "coverage_evidence": $coverage_evidence,
  "findings_count": $findings_count
}
JSON
}

tooling_failure() {
  local message="$1"
  echo "evaluate-coverage-signal.sh: $message" >&2
  write_outcome "tooling-failure" "false" "0"
  exit 1
}

if [[ $# -ne 3 ]]; then
  usage
  exit 1
fi

maestro_result_path="$1"
mobsf_report_path="$2"
output_path="$3"

[[ -r "$maestro_result_path" ]] || { echo "evaluate-coverage-signal.sh: Maestro result file not found: $maestro_result_path" >&2; exit 1; }
[[ -r "$mobsf_report_path" ]] || { echo "evaluate-coverage-signal.sh: MobSF report file not found: $mobsf_report_path" >&2; exit 1; }

jq -e . "$maestro_result_path" >/dev/null 2>&1 || tooling_failure "Maestro result is not valid JSON: $maestro_result_path"
jq -e . "$mobsf_report_path" >/dev/null 2>&1 || tooling_failure "MobSF report is not valid JSON: $mobsf_report_path"

all_steps_passed_raw="$(jq -r 'if has("all_steps_passed") then (.all_steps_passed | tostring) else "" end' "$maestro_result_path")"
case "$all_steps_passed_raw" in
  true) all_steps_passed=true ;;
  false) all_steps_passed=false ;;
  *) tooling_failure "Maestro result has no boolean all_steps_passed field: $maestro_result_path" ;;
esac

findings_count="$(jq -r 'if (.findings | type) == "array" then (.findings | length) else 0 end' "$mobsf_report_path")"

if [[ "$all_steps_passed" == "true" ]]; then
  write_outcome "pass" "true" "$findings_count"
  exit 0
fi

# Maestro did not complete the flow: no coverage/liveness evidence, so this is a failed run
# regardless of what MobSF happened to report (FR-016) -- never a false clean pass.
write_outcome "no-coverage-evidence" "false" "$findings_count"
exit 1
