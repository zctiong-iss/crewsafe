#!/usr/bin/env bash
# Surface SonarCloud dependency-risk findings into CI output (SCRUM-269,
# FR-005), and write the downloadable dependency-risk report to a path the
# workflow can upload as an artifact (FR-005a).
#
# Unlike check-sca-active.sh, this script fails OPEN on its own API errors
# (Clarifications Session 2026-08-09): the Quality Gate's actual blocking
# decision is already made independently by `sonar.qualitygate.wait`, so a
# flaky reporting/enrichment call here must not produce a false-positive job
# failure on an otherwise-clean pull request. On any API error, this script
# warns to stderr and still exits 0.
#
# Requires SONAR_TOKEN -- the existing analysis-scoped credential already
# ambient in the `sast` job, not the organization-admin SONAR_ADMIN_TOKEN
# (see check-sca-active.sh's header for why: SEC-001 keeps that token out of
# routine, automatically-triggered CI). This script only reads data.
# Usage: report-sca-findings.sh <report-output-file>
set -euo pipefail

SONAR_HOST="https://sonarcloud.io"

warn() {
  printf 'WARN: %s\n' "$1" >&2
}

[[ $# -eq 1 ]] || { printf 'ERROR: usage: report-sca-findings.sh <report-output-file>\n' >&2; exit 1; }
REPORT_OUTPUT="$1"

[[ -n "${SONAR_TOKEN:-}" ]] || { warn "SONAR_TOKEN is not set; skipping findings report"; exit 0; }

PROPS_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/sonar-project.properties"
if [[ ! -f "$PROPS_FILE" ]]; then
  warn "sonar-project.properties not found at $PROPS_FILE; skipping findings report"
  exit 0
fi

read_prop() {
  grep -E "^${1}=" "$PROPS_FILE" | head -n1 | cut -d'=' -f2-
}

SONAR_ORG="$(read_prop sonar.organization)"
SONAR_PROJECT_KEY="$(read_prop sonar.projectKey)"
if [[ -z "$SONAR_ORG" || -z "$SONAR_PROJECT_KEY" ]]; then
  warn "sonar.organization/sonar.projectKey missing from sonar-project.properties; skipping findings report"
  exit 0
fi

split_status() {
  local raw="$1"
  HTTP_STATUS="${raw##*$'\n'}"
  HTTP_BODY="${raw%$'\n'*}"
}

# --- FR-005: findings summary (Blocker/High, matching the New Code gate) --

raw="$(curl -sS -w '\n%{http_code}' -X GET \
  -H "Authorization: Bearer ${SONAR_TOKEN}" \
  "${SONAR_HOST}/api/v2/sca/issues-releases?projectKey=${SONAR_PROJECT_KEY}&organization=${SONAR_ORG}")"
split_status "$raw"

if [[ "$HTTP_STATUS" != "200" ]]; then
  warn "dependency-risk findings search failed (HTTP $HTTP_STATUS); job summary will not include SCA detail this run"
else
  printf '## Dependency risk findings\n\n'
  jq -r '
    .issuesReleases[]?
    | select(.severity == "BLOCKER" or .severity == "HIGH")
    | "- **\(.severity)** \(.vulnerabilityId // .key) in `\(.release.packageName)@\(.release.version)` (CVSS \(.cvssScore // "n/a"))"
      + (if .release.recommendedVersion then " — upgrade to `\(.release.recommendedVersion)`" else " — see SonarCloud for remediation guidance" end)
  ' <<<"$HTTP_BODY" 2>/dev/null || warn "dependency-risk findings response could not be parsed; job summary will not include SCA detail this run"
fi

# --- FR-005a: downloadable report --------------------------------------

report_raw="$(curl -sS -w '\n%{http_code}' -X GET \
  -H "Authorization: Bearer ${SONAR_TOKEN}" \
  "${SONAR_HOST}/api/v2/sca/risk-reports?projectKey=${SONAR_PROJECT_KEY}&organization=${SONAR_ORG}&format=json")"
split_status "$report_raw"

if [[ "$HTTP_STATUS" != "200" ]]; then
  warn "dependency-risk report download failed (HTTP $HTTP_STATUS); no report artifact will be attached this run"
  exit 0
fi

printf '%s' "$HTTP_BODY" >"$REPORT_OUTPUT"
