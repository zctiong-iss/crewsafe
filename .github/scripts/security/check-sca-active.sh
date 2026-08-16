#!/usr/bin/env bash
# Verify SonarCloud Advanced Security / SCA is active for this project before
# trusting the dependency-risk Quality Gate condition's result (SCRUM-269,
# FR-003a). An inactive Advanced Security subscription lets the `sast` job's
# analysis complete without error while producing no dependency-risk data at
# all -- indistinguishable from "no vulnerabilities found" unless checked
# explicitly. This script fails closed both when SCA is confirmed inactive
# AND when the verification call itself errors (Clarifications Session
# 2026-08-09): an unknown activity state is treated as unsafe, same as a
# confirmed-inactive one.
#
# Requires SONAR_TOKEN -- the existing analysis-scoped credential the `sast`
# job already holds, NOT SONAR_ADMIN_TOKEN. This is a read-only call; wiring
# an organization-admin token into a routine, automatically-triggered job
# would violate the boundary specs/019's SEC-001 established for that token
# ("MUST NOT be wired into routine, automatically-triggered CI... it never
# holds these credentials as ambient CI secrets") -- research.md R5 initially
# assumed reusing SONAR_ADMIN_TOKEN here, corrected during implementation
# once that conflict surfaced. See specs/020-ci-vulnerability-scan-gates/
# contracts/sonar-gate-sca-condition.md.
set -euo pipefail

SONAR_HOST="https://sonarcloud.io"

fail() {
  local message="$1"
  printf 'ERROR: %s\n' "$message" >&2
  exit 1
}

log_action() {
  local action="$1"
  printf 'RUN_REPORT action=%s\n' "$action"
}

[[ -n "${SONAR_TOKEN:-}" ]] || fail "SONAR_TOKEN is not set"

PROPS_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/sonar-project.properties"
[[ -f "$PROPS_FILE" ]] || fail "sonar-project.properties not found at $PROPS_FILE"

read_prop() {
  local key="$1" value
  value="$(grep -E "^${key}=" "$PROPS_FILE" | head -n1 | cut -d'=' -f2-)"
  [[ -n "$value" ]] || fail "sonar-project.properties missing or empty: $key"
  printf '%s' "$value"
}

SONAR_ORG="$(read_prop sonar.organization)"
SONAR_PROJECT_KEY="$(read_prop sonar.projectKey)"

split_status() {
  local raw="$1"
  HTTP_STATUS="${raw##*$'\n'}"
  HTTP_BODY="${raw%$'\n'*}"
}

raw="$(curl -sS -w '\n%{http_code}' -X GET \
  -H "Authorization: Bearer ${SONAR_TOKEN}" \
  "${SONAR_HOST}/api/measures/component?component=${SONAR_PROJECT_KEY}&organization=${SONAR_ORG}&metricKeys=sca_rating_any_issue")"
split_status "$raw"

[[ "$HTTP_STATUS" == "200" ]] \
  || fail "SonarQube measures/component call failed (HTTP $HTTP_STATUS): $HTTP_BODY -- treating SCA activity as unknown, failing closed"

has_sca_measure="$(jq -r '[.component.measures[]? | select(.metric == "sca_rating_any_issue")] | length' <<<"$HTTP_BODY" 2>/dev/null || printf '0')"

if [[ "$has_sca_measure" == "0" ]]; then
  fail "SonarCloud Advanced Security/SCA is not active for ${SONAR_PROJECT_KEY} (no DependencyRisks measure present) -- the dependency-risk Quality Gate condition cannot be trusted until this is resolved"
fi

log_action sca_active
