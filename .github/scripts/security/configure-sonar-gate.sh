#!/usr/bin/env bash
# Configure the SonarQube Cloud custom Quality Gate and GitHub's required
# status checks via code (SCRUM-250, follow-up to SCRUM-178).
#
# Replaces manual Steps 2.1-2.3 and Step 3 of
# docs/runbooks/SCRUM-178-manual-setup.md: creating/assigning a security-only
# custom Quality Gate, and adding three named checks to main's
# required_status_checks without a full-object PUT that would drop existing
# review requirements. See specs/019-sonar-quality-gate-automation/ for the
# full spec, plan, and design docs.
#
# Deliberately out of scope (stays manual, per that runbook and FR-008):
# starting the SonarQube Cloud trial, provisioning/rotating tokens, and the
# evidence-gathering/cleanup steps.
#
# Requires SONAR_ADMIN_TOKEN (SonarQube Cloud organization-admin token) and
# GH_ADMIN_TOKEN (GitHub token scoped to repository administration) as
# environment variables -- never as arguments (SEC-003). Supports --dry-run.
set -euo pipefail

SONAR_HOST="https://sonarcloud.io"
GITHUB_HOST="https://api.github.com"
GITHUB_OWNER="zctiong-iss"
GITHUB_REPO="crewsafe"
GITHUB_BRANCH="main"
GATE_NAME="CrewSafe Security Gate"

# The three New Code conditions this gate declares, and only these three
# (FR-002, FR-010). Never derived from input -- a hardcoded constant is what
# makes the FR-010 guard ("never a coverage/duplication condition") true by
# construction, not by discipline.
#
# Plain indexed array + case lookups, not `declare -A`: associative arrays
# need bash 4+, but this script (like the rest of .github/scripts/) must also
# run on a developer's macOS workstation, whose stock /bin/bash is 3.2.57
# (harness.sh's `in_dir` comment documents the same constraint).
DECLARED_METRICS=(new_security_issues new_security_hotspots_reviewed new_reliability_issues)

declared_op() {
  case "$1" in
    new_security_issues) printf 'GT' ;;
    new_security_hotspots_reviewed) printf 'LT' ;;
    new_reliability_issues) printf 'GT' ;;
  esac
}

declared_error() {
  case "$1" in
    new_security_issues) printf '0' ;;
    new_security_hotspots_reviewed) printf '100' ;;
    new_reliability_issues) printf '0' ;;
  esac
}

DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    *)
      printf 'ERROR: unknown argument: %s\n' "$arg" >&2
      exit 1
      ;;
  esac
done

# --- output helpers (FR-009, SC-005, SEC-004) -------------------------------

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

log_action() {
  local action="$1" target="${2:-}" mode="applied"
  [[ "$DRY_RUN" == true ]] && mode="dry_run"
  if [[ -n "$target" ]]; then
    printf 'RUN_REPORT action=%s target=%s mode=%s\n' "$action" "$target" "$mode"
  else
    printf 'RUN_REPORT action=%s mode=%s\n' "$action" "$mode"
  fi
}

warn_action() {
  local action="$1" target="${2:-}"
  if [[ -n "$target" ]]; then
    printf 'RUN_REPORT action=%s target=%s mode=warning\n' "$action" "$target" >&2
  else
    printf 'RUN_REPORT action=%s mode=warning\n' "$action" >&2
  fi
}

# --- curl wrappers (SEC-003, REL-003) ---------------------------------------
#
# `-w '\n%{http_code}'` with no --fail: HTTP-level errors (403, 404, ...) are
# NOT curl failures here, so the body and status are always both available to
# distinguish "insufficiently scoped" from other failures (FR-006). No retry
# on transient failures -- a single failed call stops the run immediately
# (Clarifications Session 2026-08-09); idempotency makes re-running safe.

split_status() {
  local raw="$1"
  HTTP_STATUS="${raw##*$'\n'}"
  HTTP_BODY="${raw%$'\n'*}"
}

sonar_api() {
  local method="$1" path="$2" raw
  shift 2
  raw="$(curl -sS -w '\n%{http_code}' -X "$method" \
    -H "Authorization: Bearer ${SONAR_ADMIN_TOKEN}" \
    "$@" "${SONAR_HOST}${path}")"
  split_status "$raw"
}

github_api() {
  local method="$1" path="$2" raw
  shift 2
  raw="$(curl -sS -w '\n%{http_code}' -X "$method" \
    -H "Authorization: Bearer ${GH_ADMIN_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    "$@" "${GITHUB_HOST}${path}")"
  split_status "$raw"
}

# --- config source (FR-003, SEC-002) ----------------------------------------

read_prop() {
  local key="$1" value
  value="$(grep -E "^${key}=" "$PROPS_FILE" | head -n1 | cut -d'=' -f2-)"
  [[ -n "$value" ]] || fail "sonar-project.properties missing or empty: $key"
  printf '%s' "$value"
}

# --- credential guards (FR-006, User Story 3) -------------------------------

require_sonar_token() {
  [[ -n "${SONAR_ADMIN_TOKEN:-}" ]] || fail "SONAR_ADMIN_TOKEN is not set"
}

require_github_token() {
  [[ -n "${GH_ADMIN_TOKEN:-}" ]] || fail "GH_ADMIN_TOKEN is not set"
}

check_sonar_auth() {
  [[ "$HTTP_STATUS" != "403" ]] \
    || fail "SONAR_ADMIN_TOKEN is present but insufficiently scoped (organization-admin required)"
}

check_github_auth() {
  [[ "$HTTP_STATUS" != "403" ]] \
    || fail "GH_ADMIN_TOKEN is present but insufficiently scoped (repository-admin required)"
}

# --- User Story 1: Quality Gate (FR-001, FR-002, FR-003) -------------------

find_gate_id() {
  sonar_api GET "/api/qualitygates/list?organization=${SONAR_ORG}"
  check_sonar_auth
  [[ "$HTTP_STATUS" == "200" ]] || fail "SonarQube qualitygates/list failed (HTTP $HTTP_STATUS): $HTTP_BODY"
  jq -r --arg name "$GATE_NAME" '.qualitygates[] | select(.name==$name) | .id' <<<"$HTTP_BODY"
}

converge_conditions() {
  local gate_id="$1" current="{}"
  if [[ -n "$gate_id" ]]; then
    sonar_api GET "/api/qualitygates/show?id=${gate_id}&organization=${SONAR_ORG}"
    check_sonar_auth
    [[ "$HTTP_STATUS" == "200" ]] || fail "SonarQube qualitygates/show failed (HTTP $HTTP_STATUS): $HTTP_BODY"
    current="$HTTP_BODY"
  fi

  local metric op error existing_op existing_error condition_id
  for metric in "${DECLARED_METRICS[@]}"; do
    op="$(declared_op "$metric")"
    error="$(declared_error "$metric")"
    existing_op="$(jq -r --arg m "$metric" '.conditions[]? | select(.metric==$m) | .op' <<<"$current")"
    existing_error="$(jq -r --arg m "$metric" '.conditions[]? | select(.metric==$m) | .error' <<<"$current")"

    if [[ -z "$existing_op" ]]; then
      GATE_CHANGED=true
      if [[ "$DRY_RUN" == true ]]; then
        log_action condition_added "$metric"
      else
        sonar_api POST "/api/qualitygates/create_condition" \
          --data-urlencode "gateId=${gate_id}" --data-urlencode "metric=${metric}" \
          --data-urlencode "op=${op}" --data-urlencode "error=${error}"
        check_sonar_auth
        [[ "$HTTP_STATUS" == "200" ]] || fail "SonarQube create_condition failed for $metric (HTTP $HTTP_STATUS): $HTTP_BODY"
        log_action condition_added "$metric"
      fi
    elif [[ "$existing_op" != "$op" || "$existing_error" != "$error" ]]; then
      GATE_CHANGED=true
      if [[ "$DRY_RUN" == true ]]; then
        log_action condition_updated "$metric"
      else
        condition_id="$(jq -r --arg m "$metric" '.conditions[]? | select(.metric==$m) | .id' <<<"$current")"
        sonar_api POST "/api/qualitygates/update_condition" \
          --data-urlencode "id=${condition_id}" --data-urlencode "metric=${metric}" \
          --data-urlencode "op=${op}" --data-urlencode "error=${error}"
        check_sonar_auth
        [[ "$HTTP_STATUS" == "200" ]] || fail "SonarQube update_condition failed for $metric (HTTP $HTTP_STATUS): $HTTP_BODY"
        log_action condition_updated "$metric"
      fi
    fi
  done
}

assign_gate() {
  local gate_id="$1" current_gate_id

  sonar_api GET "/api/qualitygates/get_by_project?project=${SONAR_PROJECT_KEY}"
  check_sonar_auth
  [[ "$HTTP_STATUS" == "200" ]] || fail "SonarQube qualitygates/get_by_project failed (HTTP $HTTP_STATUS): $HTTP_BODY"
  current_gate_id="$(jq -r '.qualityGate.id // empty' <<<"$HTTP_BODY")"

  if [[ -n "$gate_id" && "$current_gate_id" == "$gate_id" ]]; then
    return
  fi

  GATE_CHANGED=true
  if [[ "$DRY_RUN" == true ]]; then
    log_action gate_assigned "$SONAR_PROJECT_KEY"
    return
  fi

  sonar_api POST "/api/qualitygates/select" \
    --data-urlencode "gateId=${gate_id}" --data-urlencode "projectKey=${SONAR_PROJECT_KEY}"
  check_sonar_auth
  [[ "$HTTP_STATUS" == "200" || "$HTTP_STATUS" == "204" ]] \
    || fail "SonarQube qualitygates/select failed (HTTP $HTTP_STATUS): $HTTP_BODY"
  log_action gate_assigned "$SONAR_PROJECT_KEY"
}

check_new_code_definition() {
  sonar_api GET "/api/new_code_periods/list?project=${SONAR_PROJECT_KEY}"
  check_sonar_auth
  [[ "$HTTP_STATUS" == "200" ]] || fail "SonarQube new_code_periods/list failed (HTTP $HTTP_STATUS): $HTTP_BODY"

  local type
  type="$(jq -r --arg k "$SONAR_PROJECT_KEY" '.newCodePeriods[]? | select(.projectKey==$k) | .type' <<<"$HTTP_BODY")"
  case "$type" in
    PREVIOUS_VERSION | NUMBER_OF_DAYS) : ;;
    *) warn_action new_code_definition_warning "${type:-unset}" ;;
  esac
}

configure_quality_gate() {
  require_sonar_token

  local gate_id
  GATE_CHANGED=false
  gate_id="$(find_gate_id)"

  if [[ -z "$gate_id" ]]; then
    GATE_CHANGED=true
    if [[ "$DRY_RUN" == true ]]; then
      log_action gate_created "$GATE_NAME"
    else
      sonar_api POST "/api/qualitygates/create" \
        --data-urlencode "name=${GATE_NAME}" --data-urlencode "organization=${SONAR_ORG}"
      check_sonar_auth
      [[ "$HTTP_STATUS" == "200" ]] || fail "SonarQube qualitygates/create failed (HTTP $HTTP_STATUS): $HTTP_BODY"
      gate_id="$(jq -r '.id' <<<"$HTTP_BODY")"
      log_action gate_created "$GATE_NAME"
    fi
  fi

  converge_conditions "$gate_id"
  assign_gate "$gate_id"
  check_new_code_definition

  [[ "$GATE_CHANGED" == true ]] || log_action no_op "$GATE_NAME"
}

# --- User Story 2: required status checks (FR-004) --------------------------

configure_required_checks() {
  require_github_token

  github_api GET "/repos/${GITHUB_OWNER}/${GITHUB_REPO}/branches/${GITHUB_BRANCH}/protection/required_status_checks"
  check_github_auth
  [[ "$HTTP_STATUS" == "200" ]] \
    || fail "GitHub required_status_checks GET failed (HTTP $HTTP_STATUS): $HTTP_BODY"

  local strict current_contexts union_contexts
  strict="$(jq -r '.strict' <<<"$HTTP_BODY")"
  current_contexts="$(jq -c '.contexts' <<<"$HTTP_BODY")"
  union_contexts="$(jq -c -n --argjson current "$current_contexts" \
    '($current + ["Secret Scan","SAST (SonarQube)","Gate Self-Tests"]) | unique')"

  if [[ "$(jq -c 'sort' <<<"$current_contexts")" == "$(jq -c 'sort' <<<"$union_contexts")" ]]; then
    log_action no_op "required_status_checks.contexts"
    return
  fi

  if [[ "$DRY_RUN" == true ]]; then
    log_action required_checks_patched "required_status_checks.contexts"
    return
  fi

  local payload
  payload="$(jq -n --argjson strict "$strict" --argjson contexts "$union_contexts" \
    '{strict: $strict, contexts: $contexts}')"
  github_api PATCH "/repos/${GITHUB_OWNER}/${GITHUB_REPO}/branches/${GITHUB_BRANCH}/protection/required_status_checks" \
    --data "$payload"
  check_github_auth
  [[ "$HTTP_STATUS" == "200" ]] \
    || fail "GitHub required_status_checks PATCH failed (HTTP $HTTP_STATUS): $HTTP_BODY"
  log_action required_checks_patched "required_status_checks.contexts"
}

# --- entry point -------------------------------------------------------------

PROPS_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/sonar-project.properties"
[[ -f "$PROPS_FILE" ]] || fail "sonar-project.properties not found at $PROPS_FILE"
SONAR_ORG="$(read_prop sonar.organization)"
SONAR_PROJECT_KEY="$(read_prop sonar.projectKey)"

configure_quality_gate
configure_required_checks
