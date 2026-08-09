#!/usr/bin/env bash
# Surface SonarCloud dependency-risk findings into CI output (SCRUM-269,
# FR-005).
#
# Fails OPEN on its own API errors (Clarifications Session 2026-08-09): the
# Quality Gate's actual blocking decision is already made independently by
# `sonar.qualitygate.wait`, so a flaky reporting/enrichment call here must
# not produce a false-positive job failure on an otherwise-clean pull
# request. On any API error, this script warns to stderr and still exits 0.
#
# Requires SONAR_TOKEN -- the existing analysis-scoped credential already
# ambient in the `sast` job, not the organization-admin SONAR_ADMIN_TOKEN
# (see check-sca-active.sh's header for why: SEC-001 keeps that token out of
# routine, automatically-triggered CI). This script only reads data.
#
# The SCA/DependencyService API lives on a SEPARATE api.* subdomain, not
# under sonarcloud.io/api/v2 -- confirmed live 2026-08-09 against a real
# 404 in CI, then verified against both the official SwaggerHub-hosted SCA
# API docs (api-docs.sonarsource.com, "public-dependencyservice-v1-4") and
# SonarSource's own open-source sonarqube-mcp-server
# (ServerApiHelper.buildApiSubdomainUrl / ScaApi.java), which derives
# api.sonarcloud.io for the sonarcloud.io host and calls this same path
# with no /api/v2 prefix.
#
# FR-005a (a downloadable dependency-risk report, via GET .../sca/risk-
# reports) was REMOVED 2026-08-09 after confirming live -- with an
# org-Owner token, not just SONAR_TOKEN -- that this endpoint returns
# 403 "SCA feature is not enabled at Enterprise level". It is a
# SonarCloud plan/billing gate, not a permission that can be granted, so
# there is nothing this script (or any token this project can provision)
# can do about it short of an Enterprise-tier subscription. See
# docs/runbooks/SCRUM-269-ci-vulnerability-scan-gates.md #6.
#
# Usage: report-sca-findings.sh
set -euo pipefail

SONAR_API_HOST="https://api.sonarcloud.io"

warn() {
  printf 'WARN: %s\n' "$1" >&2
}

[[ -n "${SONAR_TOKEN:-}" ]] || { warn "SONAR_TOKEN is not set; skipping findings report"; exit 0; }

PROPS_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/sonar-project.properties"
if [[ ! -f "$PROPS_FILE" ]]; then
  warn "sonar-project.properties not found at $PROPS_FILE; skipping findings report"
  exit 0
fi

read_prop() {
  grep -E "^${1}=" "$PROPS_FILE" | head -n1 | cut -d'=' -f2-
}

SONAR_PROJECT_KEY="$(read_prop sonar.projectKey)"
if [[ -z "$SONAR_PROJECT_KEY" ]]; then
  warn "sonar.projectKey missing from sonar-project.properties; skipping findings report"
  exit 0
fi

split_status() {
  local raw="$1"
  HTTP_STATUS="${raw##*$'\n'}"
  HTTP_BODY="${raw%$'\n'*}"
}

# --- FR-005: findings summary (Blocker/High, matching the New Code gate) --
#
# pageSize is explicit (500, verified live 2026-08-09 to be accepted and to
# cover this project's full 120-finding backlog in one page) -- the API
# defaults to only 50 per its own documented default, which would silently
# truncate the client-side severity filter below as the backlog grows past
# that, with no error to signal it.

raw="$(curl -sS -w '\n%{http_code}' -X GET \
  -H "Authorization: Bearer ${SONAR_TOKEN}" \
  "${SONAR_API_HOST}/sca/issues-releases?projectKey=${SONAR_PROJECT_KEY}&pageSize=500")"
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
