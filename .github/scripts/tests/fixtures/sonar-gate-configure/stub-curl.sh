#!/usr/bin/env bash
# Mock curl for test-sonar-gate-configure.sh. Routes by URL substring to a
# canned response file, logs method+url+body to MOCK_CALL_LOG, and emits a
# trailing status line to emulate curl's `-w '\n%{http_code}'` (command
# substitution in the caller strips trailing newlines either way, so the
# split-on-last-line parsing works regardless of an extra newline here).
set -euo pipefail

log="${MOCK_CALL_LOG:?}"

method="GET"
body=""
prev=""
url=""
for a in "$@"; do
  case "$prev" in
    -X|--request) method="$a" ;;
    --data|--data-urlencode|--data-raw|-d) body="${body:+${body}&}${a}" ;;
  esac
  prev="$a"
done
url="${*: -1}"

{
  printf 'curl\n'
  printf 'method=%s\n' "$method"
  printf 'url=%s\n' "$url"
  [[ -n "$body" ]] && printf 'body=%s\n' "$body"
} >>"$log"

respond() {
  local response_file="$1" status="$2"
  cat "${response_file:?stub-curl: required response fixture env var not set for $url}"
  printf '\n%s' "$status"
}

case "$url" in
  *api/qualitygates/create_condition*)
    respond "${MOCK_CONDITION_CREATE_RESPONSE_FILE:?}" "${MOCK_SONAR_HTTP_STATUS:-200}" ;;
  *api/qualitygates/update_condition*)
    respond "${MOCK_CONDITION_UPDATE_RESPONSE_FILE:?}" "${MOCK_SONAR_HTTP_STATUS:-200}" ;;
  *api/qualitygates/list*)
    respond "${MOCK_GATE_LIST_RESPONSE_FILE:?}" "${MOCK_SONAR_HTTP_STATUS:-200}" ;;
  *api/qualitygates/show*)
    respond "${MOCK_GATE_SHOW_RESPONSE_FILE:?}" "${MOCK_SONAR_HTTP_STATUS:-200}" ;;
  *api/qualitygates/create*)
    respond "${MOCK_GATE_CREATE_RESPONSE_FILE:?}" "${MOCK_SONAR_HTTP_STATUS:-200}" ;;
  *api/qualitygates/select*)
    respond "${MOCK_GATE_SELECT_RESPONSE_FILE:?}" "${MOCK_SONAR_HTTP_STATUS:-200}" ;;
  *api/qualitygates/get_by_project*)
    respond "${MOCK_GATE_BY_PROJECT_RESPONSE_FILE:?}" "${MOCK_SONAR_HTTP_STATUS:-200}" ;;
  *api/new_code_periods/show*)
    respond "${MOCK_NEW_CODE_RESPONSE_FILE:?}" "${MOCK_NEW_CODE_HTTP_STATUS:-${MOCK_SONAR_HTTP_STATUS:-200}}" ;;
  */required_status_checks*)
    if [[ "$method" == "PATCH" ]]; then
      respond "${MOCK_REQUIRED_CHECKS_PATCH_RESPONSE_FILE:?}" "${MOCK_GITHUB_HTTP_STATUS:-200}"
    else
      respond "${MOCK_REQUIRED_CHECKS_GET_RESPONSE_FILE:?}" "${MOCK_GITHUB_HTTP_STATUS:-200}"
    fi
    ;;
  *api/measures/component*)
    # check-sca-active.sh (SCRUM-269, FR-003a): whether a DependencyRisks
    # measure is present at all is how SCA-active is inferred.
    respond "${MOCK_SCA_MEASURES_RESPONSE_FILE:?}" "${MOCK_SONAR_HTTP_STATUS:-200}" ;;
  *api.sonarcloud.io/sca/issues-releases/change-status*)
    # apply-sca-exceptions.sh (SCRUM-269, FR-007/FR-008): transitions a
    # dependency-risk finding's status. Host/path verified live 2026-08-09
    # against the official SwaggerHub SCA API docs and SonarSource's own
    # open-source sonarqube-mcp-server (api.sonarcloud.io, no /api/v2
    # prefix, flat POST with the key in the body) -- corrected from an
    # earlier unverified /api/v2/sca/issues-releases/{key}/transition guess.
    # The exact transitionKey enum value is still unverified; see
    # specs/020-ci-vulnerability-scan-gates/tasks.md T036.
    respond "${MOCK_DEPENDENCY_RISK_TRANSITION_RESPONSE_FILE:?}" "${MOCK_SONAR_HTTP_STATUS:-200}" ;;
  *api.sonarcloud.io/sca/issues-releases*)
    # report-sca-findings.sh (FR-005): search dependency risks for a project.
    respond "${MOCK_DEPENDENCY_RISK_SEARCH_RESPONSE_FILE:?}" "${MOCK_SONAR_HTTP_STATUS:-200}" ;;
  *api.sonarcloud.io/sca/risk-reports*)
    # report-sca-findings.sh (FR-005a): downloadable dependency-risk report.
    respond "${MOCK_DEPENDENCY_RISK_REPORT_RESPONSE_FILE:?}" "${MOCK_SONAR_HTTP_STATUS:-200}" ;;
  *)
    printf 'stub-curl: unrecognized URL: %s\n' "$url" >&2
    exit 1
    ;;
esac
