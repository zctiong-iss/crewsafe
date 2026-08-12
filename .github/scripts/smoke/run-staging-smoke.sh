#!/usr/bin/env bash
set -euo pipefail

TMP_DIR="$(mktemp -d)"
EVIDENCE_FILE="${SMOKE_EVIDENCE_FILE:-$TMP_DIR/smoke-evidence.json}"
SUMMARY_FILE="${GITHUB_STEP_SUMMARY:-$TMP_DIR/summary.md}"
RUNBOOK_PATH='docs/runbooks/SCRUM-272-staging-smoke-tests.md'
CHECKS_JSON='[]'
OVERALL_RESULT=passed
FAILURE_CATEGORY=''
ACCESS_TOKEN=''

safe_run_url() {
  local value="${1:-}"
  if [[ "$value" =~ ^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/actions/runs/[0-9]+$ ]]; then
    printf '%s' "$value"
  fi
}

record_check() {
  local name="$1" result="$2" category="$3" status="${4:-}" attempts="${5:-1}" duration_ms="${6:-0}"
  local status_json=null
  [[ "$status" =~ ^[0-9]{3}$ ]] && status_json="$status"
  CHECKS_JSON="$(jq -c \
    --arg name "$name" \
    --arg result "$result" \
    --arg category "$category" \
    --argjson http_status "$status_json" \
    --argjson attempts "$attempts" \
    --argjson duration_ms "$duration_ms" \
    '. + [{name: $name, result: $result, category: $category, http_status: $http_status, attempts: $attempts, duration_ms: $duration_ms}]' \
    <<<"$CHECKS_JSON")"
}

mark_failure() {
  OVERALL_RESULT=failed
  [[ -n "$FAILURE_CATEGORY" ]] || FAILURE_CATEGORY="$1"
}

request() {
  local body_path="$1" url="$2" token="${3:-}"
  local attempt rc status
  REQUEST_STATUS=''
  REQUEST_ATTEMPTS=0
  REQUEST_CATEGORY='transport'
  local -a args=(-sS --max-time 15 --connect-timeout 15 -o "$body_path" -w '%{http_code}' -X GET)
  [[ -n "$token" ]] && args+=(-H "Authorization: Bearer $token")

  for attempt in 1 2; do
    REQUEST_ATTEMPTS="$attempt"
    : >"$body_path"
    if status="$(curl "${args[@]}" "$url" 2>"$TMP_DIR/curl.stderr")"; then
      rc=0
    else
      rc=$?
    fi

    if [[ "$rc" != 0 || ! "$status" =~ ^[0-9]{3}$ ]]; then
      REQUEST_CATEGORY=$([[ "$rc" == 28 ]] && printf 'timeout' || printf 'transport')
      [[ "$attempt" == 1 ]] && continue
      return 1
    fi

    REQUEST_STATUS="$status"
    if (( status >= 500 && status <= 599 )); then
      REQUEST_CATEGORY=server_error
      [[ "$attempt" == 1 ]] && continue
      return 1
    fi
    if (( status >= 300 && status <= 399 )); then REQUEST_CATEGORY=redirect; return 1; fi
    if (( status == 401 || status == 403 )); then REQUEST_CATEGORY=unauthorized; return 1; fi
    if (( status < 200 || status >= 300 )); then REQUEST_CATEGORY=http_status; return 1; fi
    return 0
  done
  return 1
}

check_json() {
  local name="$1" url="$2" filter="$3" token="${4:-}"
  local body="$TMP_DIR/${name}.body" started ended duration
  started="$(date +%s)"
  if request "$body" "$url" "$token"; then
    if jq -e --arg site "$SMOKE_SITE_ID" "$filter" "$body" >/dev/null 2>&1; then
      ended="$(date +%s)"; duration=$(( (ended - started) * 1000 ))
      record_check "$name" passed passed "$REQUEST_STATUS" "$REQUEST_ATTEMPTS" "$duration"
      return 0
    fi
    REQUEST_CATEGORY=invalid_shape
  fi
  ended="$(date +%s)"; duration=$(( (ended - started) * 1000 ))
  local category="${REQUEST_CATEGORY:-invalid_shape}"
  [[ -n "${REQUEST_STATUS:-}" ]] || category=invalid_shape
  [[ "$category" == transport && "${REQUEST_STATUS:-}" == '' ]] && category="${REQUEST_CATEGORY:-transport}"
  [[ -n "${REQUEST_STATUS:-}" && "$category" == invalid_shape ]] && category=invalid_shape
  record_check "$name" failed "$category" "${REQUEST_STATUS:-}" "${REQUEST_ATTEMPTS:-1}" "$duration"
  mark_failure "$category"
  return 1
}

check_web_surface() {
  local body="$TMP_DIR/deployment_surface.body" started ended duration
  started="$(date +%s)"
  if request "$body" "$WEB_BASE_URL/" && grep -Eiq '<!doctype html|<html' "$body"; then
    ended="$(date +%s)"; duration=$(( (ended - started) * 1000 ))
    record_check deployment_surface passed passed "$REQUEST_STATUS" "$REQUEST_ATTEMPTS" "$duration"
    return 0
  fi
  ended="$(date +%s)"; duration=$(( (ended - started) * 1000 ))
  local category="${REQUEST_CATEGORY:-invalid_shape}"
  [[ -n "${REQUEST_STATUS:-}" && "$category" == transport ]] && category=invalid_shape
  record_check deployment_surface failed "$category" "${REQUEST_STATUS:-}" "${REQUEST_ATTEMPTS:-1}" "$duration"
  mark_failure "$category"
  return 1
}

authenticate() {
  local region client_id auth_output
  region="$(jq -er '.accounts.dev.region' <<<"$COGNITO_CONFIG_JSON" 2>"$TMP_DIR/config.err")" || return 1
  client_id="$(jq -er '.accounts.dev.cli_client_id' <<<"$COGNITO_CONFIG_JSON" 2>"$TMP_DIR/config.err")" || return 1
  auth_output="$TMP_DIR/auth.json"
  if ! aws cognito-idp initiate-auth --no-sign-request \
    --region "$region" \
    --client-id "$client_id" \
    --auth-flow USER_PASSWORD_AUTH \
    --auth-parameters "USERNAME=$SMOKE_USERNAME,PASSWORD=$SMOKE_SYNTHETIC_WORKER_PASSWORD" \
    --output json >"$auth_output" 2>"$TMP_DIR/auth.err"; then
    return 1
  fi
  ACCESS_TOKEN="$(jq -er '.AuthenticationResult.AccessToken | strings | select(length > 0)' "$auth_output" 2>"$TMP_DIR/token.err")" || return 1
  return 0
}

check_critical_workflow() {
  local shift_body="$TMP_DIR/critical_shift.body" weather_body="$TMP_DIR/critical_weather.body"
  local started ended duration category=''
  local shift_status='' shift_attempts=1 weather_status='' weather_attempts=1
  started="$(date +%s)"

  if ! request "$shift_body" "$BACKEND_BASE_URL/api/v1/shifts/me" "$ACCESS_TOKEN"; then
    category="${REQUEST_CATEGORY:-transport}"
    shift_status="${REQUEST_STATUS:-}"
    shift_attempts="${REQUEST_ATTEMPTS:-1}"
  elif ! jq -e '.shift != null and (.shift.shiftId | strings | length > 0) and (.shift.assignment.taskName | strings | length > 0)' "$shift_body" >/dev/null 2>&1; then
    category=invalid_shape
    shift_status="$REQUEST_STATUS"
    shift_attempts="$REQUEST_ATTEMPTS"
  elif ! request "$weather_body" "$BACKEND_BASE_URL/api/v1/sites/$SMOKE_SITE_ID/weather/latest" "$ACCESS_TOKEN"; then
    category="${REQUEST_CATEGORY:-transport}"
    weather_status="${REQUEST_STATUS:-}"
    weather_attempts="${REQUEST_ATTEMPTS:-1}"
  elif ! jq -e --arg site "$SMOKE_SITE_ID" \
    '.siteId == $site and (.observedAt | strings | length > 0) and ((.wbgt | numbers) or (.temperature | numbers) or (.humidity | numbers))' \
    "$weather_body" >/dev/null 2>&1; then
    category=invalid_shape
    weather_status="$REQUEST_STATUS"
    weather_attempts="$REQUEST_ATTEMPTS"
  fi

  ended="$(date +%s)"; duration=$(( (ended - started) * 1000 ))
  if [[ -z "$category" ]]; then
    record_check critical_workflow passed passed "$REQUEST_STATUS" "$weather_attempts" "$duration"
    return 0
  fi
  [[ -n "$weather_status" ]] || weather_status="$shift_status"
  [[ "$weather_attempts" -gt "$shift_attempts" ]] || weather_attempts="$shift_attempts"
  record_check critical_workflow failed "$category" "$weather_status" "$weather_attempts" "$duration"
  mark_failure "$category"
  return 1
}

write_summary() {
  mkdir -p "$(dirname "$SUMMARY_FILE")"
  {
    printf '## Staging smoke verification\n\n'
    printf -- '- Component: `%s`\n' "$TRIGGER_COMPONENT"
    printf -- '- Deployment revision: `%s`\n' "$TRIGGER_SHA"
    printf -- '- Result: `%s`\n' "$OVERALL_RESULT"
    [[ -n "$FAILURE_CATEGORY" ]] && printf -- '- Failure category: `%s`\n' "$FAILURE_CATEGORY"
    printf -- '- Runbook: `%s`\n\n' "$RUNBOOK_PATH"
    printf '| Check | Result | Category | HTTP status | Attempts |\n| --- | --- | --- | ---: | ---: |\n'
    jq -r '.[] | "| \(.name) | \(.result) | \(.category) | \(.http_status // "-") | \(.attempts) |"' <<<"$CHECKS_JSON"
  } >>"$SUMMARY_FILE"
}

write_evidence() {
  local failure_json=null deployment_url smoke_url
  [[ -n "$FAILURE_CATEGORY" ]] && failure_json="$(jq -nc --arg value "$FAILURE_CATEGORY" '$value')"
  deployment_url="$(safe_run_url "${DEPLOYMENT_RUN_URL:-}")"
  smoke_url="$(safe_run_url "${SMOKE_RUN_URL:-}")"
  mkdir -p "$(dirname "$EVIDENCE_FILE")"
  jq -n \
    --argjson schema_version 1 \
    --arg revision "$TRIGGER_SHA" \
    --arg component "$TRIGGER_COMPONENT" \
    --arg web_host "${WEB_BASE_URL#https://}" \
    --arg backend_host "${BACKEND_BASE_URL#https://}" \
    --argjson checks "$CHECKS_JSON" \
    --arg overall_result "$OVERALL_RESULT" \
    --argjson failure_category "$failure_json" \
    --arg deployment_run_url "$deployment_url" \
    --arg smoke_run_url "$smoke_url" \
    --arg recorded_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg runbook_path "$RUNBOOK_PATH" \
    '{schema_version: $schema_version, revision: $revision, component: $component, target_hosts: [$web_host, $backend_host], checks: $checks, overall_result: $overall_result, failure_category: $failure_category, deployment_run_url: (if $deployment_run_url == "" then null else $deployment_run_url end), smoke_run_url: (if $smoke_run_url == "" then null else $smoke_run_url end), recorded_at: $recorded_at, runbook_path: $runbook_path}' \
    >"$EVIDENCE_FILE"
}

cleanup() {
  local rc=$?
  set +e
  if [[ "$rc" == 0 && "$OVERALL_RESULT" == passed ]]; then
    write_summary || rc=1
  else
    write_summary || rc=1
  fi
  write_evidence || rc=1
  rm -rf "$TMP_DIR"
  exit "$rc"
}
trap cleanup EXIT INT TERM

if [[ "$TRIGGER_COMPONENT" == backend ]]; then
  check_json deployment_surface "$BACKEND_BASE_URL/actuator/health/liveness" '.status == "UP"' || exit 1
else
  check_web_surface || exit 1
fi
check_json service_readiness "$BACKEND_BASE_URL/actuator/health/readiness" '.status == "UP"' || exit 1

if ! authenticate; then
  record_check authenticated_access failed unauthorized '' 1 0
  mark_failure unauthorized
  exit 1
fi
check_json authenticated_access "$BACKEND_BASE_URL/api/v1/me" \
  '(.id | type == "string" and length > 0) and (.username | type == "string" and length > 0) and (.role == "WORKER") and (.siteIds | type == "array" and index($site) != null)' \
  "$ACCESS_TOKEN" || exit 1
check_critical_workflow || exit 1

exit 0
