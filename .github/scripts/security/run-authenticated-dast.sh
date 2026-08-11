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
command -v envsubst >/dev/null || { echo 'envsubst is required to resolve the DAST policy' >&2; exit 1; }

tmp_dir="$(mktemp -d /tmp/crewsafe-dast.XXXXXX)"
cleanup() { rm -rf "$tmp_dir"; }
trap cleanup EXIT INT TERM
started_at="$(date +%s)"

web_host="${WEB_BASE_URL#https://}"
backend_host="${BACKEND_BASE_URL#https://}"
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"
run_log="$tmp_dir/zap-run.log"
report_dir="$tmp_dir/report"
zap_log="$tmp_dir/zap.log"
plan_dir="$tmp_dir/plan"
mkdir -p "$report_dir" "$plan_dir"
# ZAP runs as the non-root `zap` user. Keep the ephemeral parent private while
# allowing that user to traverse it and write the mounted output directories and
# single internal log file. Mounting one file avoids leaving container-owned
# runtime files on the GitHub runner during cleanup.
chmod 711 "$tmp_dir"
chmod 733 "$report_dir"
: >"$zap_log"
chmod 666 "$zap_log"

# ZAP's Automation Framework does not reliably substitute ${ENV_VAR} in every
# field of the plan — pollUrl in particular is a documented gap
# (zaproxy/zaproxy#8777, #7201) even though the same syntax resolves correctly
# in context.urls. Resolve every placeholder ourselves before ZAP ever sees the
# file, so a scan can't silently run against a broken, unsubstituted URL. The
# guard script is copied alongside the resolved plan because its `source:`
# path is resolved relative to the plan file's own directory.
envsubst '${WEB_BASE_URL} ${BACKEND_BASE_URL} ${HOSTED_UI_URL} ${DAST_USERNAME} ${DAST_SYNTHETIC_WORKER_PASSWORD}' \
  <"$policy_path" >"$plan_dir/automation.yaml"
cp "$guard_path" "$plan_dir/active-scan-method-guard.js"
chmod 711 "$plan_dir"
chmod 644 "$plan_dir/automation.yaml" "$plan_dir/active-scan-method-guard.js"

redacted_zap_diagnostic() {
  local diagnostic source
  for source in "$zap_log" "$run_log"; do
    [[ -r "$source" ]] || continue
    diagnostic="$(grep -Ei 'automation framework|automation plan|error|warn|fail|exception|caused by|invalid|unknown|unable|denied|not found|rejected|timeout|timed out|refused' "$source" \
      | grep -Ev '^[[:space:]]+at ' \
      | tail -n 1 || true)"
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
  -v "$plan_dir:/zap/plan:ro"
  -v "$report_dir:/zap/dast-output"
  -v "$zap_log:/home/zap/.ZAP/zap.log"
  "$ZAP_IMAGE"
)

zap_command=(zap.sh -loglevel INFO -cmd -notel)

# Validate the policy syntax before any target request. Redirect all scanner output
# to temporary storage because browser/session diagnostics can be sensitive.
preflight_rc=0
docker "${docker_args[@]}" "${zap_command[@]}" -autocheck /zap/plan/automation.yaml >"$run_log" 2>&1 \
  || preflight_rc=$?
if (( preflight_rc != 0 )); then
  printf 'DAST policy preflight failed (docker_exit=%s; %s); no staging scan was started.\n' \
    "$preflight_rc" "$(preflight_failure_reason)" >&2
  exit 1
fi

scan_rc=0
docker "${docker_args[@]}" "${zap_command[@]}" -autorun /zap/plan/automation.yaml >"$run_log" 2>&1 \
  || scan_rc=$?
report="$report_dir/dast-report.json"
warning_state='none'
if (( scan_rc == 1 )); then
  report_state='no reviewable report was produced'
  [[ -s "$report" ]] && report_state='a report was produced, but the Automation Framework plan was not clean'
  printf 'Authenticated DAST scan failed (docker_exit=%s; %s; %s).\n' \
    "$scan_rc" "$(scan_failure_reason)" "$report_state" >&2
  exit 1
elif (( scan_rc == 2 )); then
  warning_state='ZAP reported plan warnings (docker_exit=2)'
  report_state='no reviewable report was produced'
  [[ -s "$report" ]] && report_state='a report was produced; warnings remain advisory'
  printf 'Authenticated DAST scan completed with warnings (docker_exit=2; %s; %s).\n' \
    "$(redacted_zap_diagnostic)" "$report_state" >&2
elif (( scan_rc != 0 )); then
  report_state='no reviewable report was produced'
  [[ -s "$report" ]] && report_state='a report was produced, but the Automation Framework plan was not clean'
  printf 'Authenticated DAST scan failed (docker_exit=%s; %s; %s).\n' \
    "$scan_rc" "$(scan_failure_reason)" "$report_state" >&2
  exit 1
fi

[[ -s "$report" ]] || { echo 'DAST scan produced no reviewable report.' >&2; exit 1; }

sites_scanned="$(jq '[.site[]?] | length' "$report")"
endpoints_scanned="$(jq '[.insights[]? | select(.key=="insight.endpoint.total") | (.statistic | tonumber?)] | add // 0' "$report")"

# A report with zero scanned endpoints means the crawl never generated
# reviewable traffic, regardless of what the ZAP exit code claims. Treat that
# as an unavailable security-control result rather than a clean or advisory
# one, so an aborted authentication/crawl cannot silently read as "0 findings".
if (( endpoints_scanned == 0 )); then
  printf 'Authenticated DAST scan produced a report with zero scanned endpoints (docker_exit=%s; %s; sites=%s); treating as an incomplete scan, not a clean result.\n' \
    "$scan_rc" "$(redacted_zap_diagnostic)" "$sites_scanned" >&2
  exit 1
fi

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
  printf '%s\n' '## Authenticated staging DAST (advisory)'
  printf -- '- Trigger: `%s` deployment at commit `%s`\n' "$TRIGGER_COMPONENT" "$TRIGGER_SHA"
  printf -- '- Scan origins: `%s`, `%s`\n' "$web_host" "$backend_host"
  printf -- '- Scanner image: `%s`\n' "${ZAP_IMAGE##*@}"
  printf -- '- Policy: `%s`\n' 'SCRUM-273 GET/HEAD active-scan boundary'
  printf -- '- Duration: %ss\n' "$duration_seconds"
  printf -- '- Scan status: %s\n' "$warning_state"
  printf -- '- Endpoint coverage: sites=%s, endpoints=%s\n' "$sites_scanned" "$endpoints_scanned"
  printf -- '- Finding counts: high=%s, medium=%s, low=%s, informational=%s\n' \
    "$high" "$medium" "$low" "$informational"
  printf '%s\n' '- Result: advisory findings require validation; SCRUM-297 owns promotion blocking.'
} >>"$summary"
