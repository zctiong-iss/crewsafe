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
zap_home="$tmp_dir/home"
zap_log="$zap_home/zap.log"
mkdir -p "$report_dir" "$zap_home"
# ZAP runs as the non-root `zap` user. Keep the ephemeral parent private while
# allowing that user to traverse it and write only the mounted output directories.
chmod 711 "$tmp_dir"
chmod 733 "$report_dir" "$zap_home"

redacted_zap_diagnostic() {
  local diagnostic source
  for source in "$zap_log" "$run_log"; do
    [[ -r "$source" ]] || continue
    diagnostic="$(grep -Ei 'automation framework|automation plan|error|warn|fail|exception|invalid|unknown|unable|denied|not found|rejected|timeout|timed out|refused' "$source" | tail -n 1 || true)"
    [[ -n "$diagnostic" ]] || continue
    diagnostic="$(printf '%s' "$diagnostic" \
      | sed -E \
          -e 's#https?://[^[:space:]]+#<redacted-url>#g' \
          -e 's#DAST_[A-Z0-9_]+=[^[:space:]]+#DAST_[redacted]=[redacted]#g' \
          -e 's#(password|token|cookie|authorization|username|secret|access_token|refresh_token)[^:= ]*[:=][[:space:]]*[^,;[:space:]]+#\1=[redacted]#Ig' \
          -e 's#Bearer[[:space:]]+[A-Za-z0-9._~+/=-]+#Bearer [redacted]#Ig' \
          -e 's#[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}#<redacted-jwt>#g' \
          -e 's#[[:alnum:]._%+-]+@[[:alnum:].-]+\.[A-Za-z]{2,}#<redacted-email>#g' \
      | cut -c1-240)"
    printf 'ZAP emitted a redacted diagnostic from %s: %s' "$(basename "$source")" "$diagnostic"
    return 0
  done
  echo 'ZAP did not emit a classifiable diagnostic (checked scanner output and internal ZAP log)'
}

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
    redacted_zap_diagnostic
  fi
}

scan_failure_reason() {
  if grep -Fq -- 'Blocked Active Scanner request outside approved staging hosts' "$run_log"; then
    echo 'Active Scanner host guard blocked a request outside the approved staging hosts'
  elif grep -Fq -- 'Blocked non-GET/HEAD Active Scanner request' "$run_log"; then
    echo 'Active Scanner method guard blocked a non-GET/HEAD request'
  elif grep -Eiq -- 'browser authentication|authentication.*(failed|error)|login.*(failed|error)' "$run_log"; then
    echo 'ZAP browser authentication or session setup failed'
  elif grep -Eiq -- 'connection refused|timed out|timeout|unknown host|name or service not known|unable to connect' "$run_log"; then
    echo 'ZAP could not reach a staging target'
  elif grep -Eiq -- 'report.*(failed|error)|failed to (generate|write).*report|could not (generate|write).*report|unable to (generate|write).*report' "$run_log"; then
    echo 'ZAP failed to write its reviewable report'
  elif grep -Fq -- 'Exception' "$run_log"; then
    echo 'ZAP reported an internal scan exception'
  else
    redacted_zap_diagnostic
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
  -v "$zap_home:/zap/home"
  "$ZAP_IMAGE"
)

zap_command=(zap.sh -dir /zap/home -loglevel INFO -cmd -notel)

# Validate the policy syntax before any target request. Redirect all scanner output
# to temporary storage because browser/session diagnostics can be sensitive.
preflight_rc=0
docker "${docker_args[@]}" "${zap_command[@]}" -autocheck "/zap/wrk/$policy_rel" >"$run_log" 2>&1 \
  || preflight_rc=$?
if (( preflight_rc != 0 )); then
  printf 'DAST policy preflight failed (docker_exit=%s; %s); no staging scan was started.\n' \
    "$preflight_rc" "$(preflight_failure_reason)" >&2
  exit 1
fi

scan_rc=0
docker "${docker_args[@]}" "${zap_command[@]}" -autorun "/zap/wrk/$policy_rel" >"$run_log" 2>&1 \
  || scan_rc=$?
report="$report_dir/dast-report.json"
if (( scan_rc != 0 )); then
  report_state='no reviewable report was produced'
  [[ -s "$report" ]] && report_state='a report was produced, but the Automation Framework plan was not clean'
  printf 'Authenticated DAST scan failed (docker_exit=%s; %s; %s).\n' \
    "$scan_rc" "$(scan_failure_reason)" "$report_state" >&2
  exit 1
fi

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
