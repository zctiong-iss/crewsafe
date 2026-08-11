#!/usr/bin/env bash
set -euo pipefail

for required in WEB_BASE_URL BACKEND_BASE_URL HOSTED_UI_URL DAST_USERNAME \
  DAST_SYNTHETIC_WORKER_PASSWORD ZAP_IMAGE TRIGGER_COMPONENT TRIGGER_SHA; do
  [[ -n "${!required:-}" ]] || { echo "Missing required DAST runtime configuration: $required" >&2; exit 1; }
done

workspace="${GITHUB_WORKSPACE:-$(pwd)}"
policy_rel='.github/security/dast/automation.yaml'
policy_path="$workspace/$policy_rel"
guard_path="$workspace/.github/security/dast/active-scan-method-guard.js"
[[ -r "$policy_path" && -r "$guard_path" ]] || { echo 'DAST policy files are unavailable' >&2; exit 1; }

tmp_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/crewsafe-dast.XXXXXX")"
cleanup() { rm -rf "$tmp_dir"; }
trap cleanup EXIT INT TERM
started_at="$(date +%s)"

web_host="${WEB_BASE_URL#https://}"
backend_host="${BACKEND_BASE_URL#https://}"
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"
run_log="$tmp_dir/zap.log"
report_dir="$tmp_dir/report"
mkdir -p "$report_dir"

docker_args=(
  run --rm
  -e "WEB_BASE_URL=$WEB_BASE_URL"
  -e "BACKEND_BASE_URL=$BACKEND_BASE_URL"
  -e "HOSTED_UI_URL=$HOSTED_UI_URL"
  -e "DAST_USERNAME=$DAST_USERNAME"
  -e "DAST_SYNTHETIC_WORKER_PASSWORD=$DAST_SYNTHETIC_WORKER_PASSWORD"
  -e "DAST_WEB_HOST=$web_host"
  -e "DAST_BACKEND_HOST=$backend_host"
  -e 'DAST_REPORT_DIR=/zap/wrk/dast-output'
  -v "$workspace:/zap/wrk:ro"
  -v "$report_dir:/zap/wrk/dast-output"
  "$ZAP_IMAGE"
)

# Validate the policy syntax before any target request. Redirect all scanner output
# to temporary storage because browser/session diagnostics can be sensitive.
if ! docker "${docker_args[@]}" zap.sh -cmd -autocheck "/zap/wrk/$policy_rel" >"$run_log" 2>&1; then
  echo 'DAST policy preflight failed; no staging scan was started.' >&2
  exit 1
fi

if ! docker "${docker_args[@]}" zap.sh -cmd -autorun "/zap/wrk/$policy_rel" >"$run_log" 2>&1; then
  echo 'Authenticated DAST scan was unavailable or failed; it is not a clean result.' >&2
  exit 1
fi

report="$report_dir/dast-report.json"
[[ -s "$report" ]] || { echo 'DAST scan produced no reviewable report.' >&2; exit 1; }

severity_count() {
  local severity="$1"
  jq --arg severity "$severity" '[.. | objects | select((.riskdesc? // .risk? // "") | tostring | ascii_upcase | startswith($severity))] | length' "$report"
}

high="$(severity_count HIGH)"
medium="$(severity_count MEDIUM)"
low="$(severity_count LOW)"
informational="$(severity_count INFORMATIONAL)"
duration_seconds="$(( $(date +%s) - started_at ))"

{
  echo '## Authenticated staging DAST (advisory)'
  echo "- Trigger: `$TRIGGER_COMPONENT` deployment at commit `$TRIGGER_SHA`"
  echo "- Scan origins: `$web_host`, `$backend_host`"
  echo "- Scanner image: `${ZAP_IMAGE##*@}`"
  echo "- Policy: `SCRUM-273 GET/HEAD active-scan boundary`"
  echo "- Duration: ${duration_seconds}s"
  echo "- Finding counts: high=${high}, medium=${medium}, low=${low}, informational=${informational}"
  echo '- Result: advisory findings require validation; SCRUM-297 owns promotion blocking.'
} >>"$summary"
