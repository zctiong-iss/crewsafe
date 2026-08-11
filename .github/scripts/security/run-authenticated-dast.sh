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

tmp_dir="$(mktemp -d /tmp/crewsafe-dast.XXXXXX)"
cleanup() { rm -rf "$tmp_dir"; }
trap cleanup EXIT INT TERM
started_at="$(date +%s)"

web_host="${WEB_BASE_URL#https://}"
backend_host="${BACKEND_BASE_URL#https://}"
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"
run_log="$tmp_dir/zap.log"
report_dir="$tmp_dir/report"
mkdir -p "$report_dir"

preflight_failure_reason() {
  if grep -Fq -- 'Could not determine local host name' "$run_log"; then
    echo 'ZAP container hostname resolution failed'
  elif grep -Fq -- 'Error reading parameters' "$run_log"; then
    echo 'ZAP Automation Framework parameter validation failed'
  elif grep -Fq -- 'Unrecognised active scan rule ID' "$run_log"; then
    echo 'ZAP active-scan policy contains an unrecognised rule'
  elif grep -Fq -- 'No such file' "$run_log"; then
    echo 'ZAP policy or script file was unavailable'
  elif grep -Fq -- 'Permission denied' "$run_log"; then
    echo 'ZAP policy or report path permission was denied'
  elif grep -Fq -- 'Exception' "$run_log"; then
    echo 'ZAP reported an internal preflight exception'
  else
    local diagnostic
    diagnostic="$(grep -Ei 'error|warn|fail|exception|invalid|unknown|unable|denied|not found|rejected' "$run_log" | tail -n 1 || true)"
    if [[ -n "$diagnostic" ]]; then
      diagnostic="$(printf '%s' "$diagnostic" \
        | sed -E \
            -e 's#https?://[^[:space:]]+#<redacted-url>#g' \
            -e 's#DAST_[A-Z0-9_]+=[^[:space:]]+#DAST_[redacted]=[redacted]#g' \
            -e 's#(password|token|cookie|authorization|username)[^= ]*=[^[:space:]]+#\1=[redacted]#Ig' \
        | cut -c1-240)"
      printf 'ZAP emitted a redacted diagnostic: %s' "$diagnostic"
    else
      echo 'ZAP rejected the policy or failed to start'
    fi
  fi
}

docker_args=(
  run --rm
  --hostname zap-dast
  --add-host 'zap-dast:127.0.0.1'
  -e "WEB_BASE_URL=$WEB_BASE_URL"
  -e "BACKEND_BASE_URL=$BACKEND_BASE_URL"
  -e "HOSTED_UI_URL=$HOSTED_UI_URL"
  -e "DAST_USERNAME=$DAST_USERNAME"
  -e "DAST_SYNTHETIC_WORKER_PASSWORD=$DAST_SYNTHETIC_WORKER_PASSWORD"
  -e "DAST_WEB_HOST=$web_host"
  -e "DAST_BACKEND_HOST=$backend_host"
  -e 'DAST_REPORT_DIR=/zap/dast-output'
  -v "$workspace:/zap/wrk:ro"
  -v "$report_dir:/zap/dast-output"
  "$ZAP_IMAGE"
)

# Validate the policy syntax before any target request. Redirect all scanner output
# to temporary storage because browser/session diagnostics can be sensitive.
preflight_rc=0
docker "${docker_args[@]}" zap.sh -cmd -notel -autocheck "/zap/wrk/$policy_rel" >"$run_log" 2>&1 \
  || preflight_rc=$?
if (( preflight_rc != 0 )); then
  printf 'DAST policy preflight failed (docker_exit=%s; %s); no staging scan was started.\n' \
    "$preflight_rc" "$(preflight_failure_reason)" >&2
  exit 1
fi

if ! docker "${docker_args[@]}" zap.sh -cmd -notel -autorun "/zap/wrk/$policy_rel" >"$run_log" 2>&1; then
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
