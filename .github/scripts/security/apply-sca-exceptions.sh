#!/usr/bin/env bash
# Apply version-controlled, time-bounded exceptions for SonarCloud dependency
# risks (SCRUM-269, User Story 3, FR-007/FR-008): read
# .github/security/sca-exceptions.yml, drop expired/malformed entries, and
# transition each surviving finding via SonarCloud's dependency-risk
# transition endpoint so it stops counting against the New Code
# `new_sca_rating_vulnerability` Quality Gate condition.
#
# Expiry is enforced by exclusion, matching filter-trivyignore.sh: an expired
# or malformed entry is simply never sent, so it reverts to blocking on its
# own on the next run -- no separate expiry-aware logic at transition time.
#
# A transition-call failure for a listed (non-expired, well-formed) key is a
# script failure, not a silent skip -- an exception a maintainer explicitly
# configured must either apply or visibly fail (data-model.md).
#
# The exceptions.yml format is a small, fixed shape (list of key/reason/
# expires records), parsed directly with awk rather than adding a YAML
# library as a new dependency (plan.md Technical Context: no new dependency
# beyond curl+jq).
#
# Requires SONAR_ADMIN_TOKEN (reused from specs/019, research.md R5).
#
# The SCA/DependencyService API lives on the SEPARATE api.* subdomain, not
# under sonarcloud.io/api/v2, and the transition call is a single flat POST
# with the target key in the BODY -- not a /{key}/transition path as first
# guessed. Both corrected live 2026-08-09 (see report-sca-findings.sh's
# header for the full verification trail: SwaggerHub SCA API docs +
# SonarSource's own open-source sonarqube-mcp-server). The exact
# `transitionKey` enum value for "accept this risk" is still UNVERIFIED --
# see the inline note below and specs/020-ci-vulnerability-scan-gates/
# tasks.md T036.
# Usage: apply-sca-exceptions.sh <exceptions-file>
set -euo pipefail

SONAR_API_HOST="https://api.sonarcloud.io"

fail() {
  local message="$1"
  printf 'ERROR: %s\n' "$message" >&2
  exit 1
}

log_action() {
  local action="$1" target="$2"
  printf 'RUN_REPORT action=%s target=%s\n' "$action" "$target"
}

[[ $# -eq 1 ]] || fail "usage: apply-sca-exceptions.sh <exceptions-file>"
EXCEPTIONS_FILE="$1"
[[ -f "$EXCEPTIONS_FILE" ]] || fail "exceptions file not found: $EXCEPTIONS_FILE"
[[ -n "${SONAR_ADMIN_TOKEN:-}" ]] || fail "SONAR_ADMIN_TOKEN is not set"

split_status() {
  local raw="$1"
  HTTP_STATUS="${raw##*$'\n'}"
  HTTP_BODY="${raw%$'\n'*}"
}

# Emit one "<key>\t<reason>\t<expires>" record per well-formed entry (key AND
# expires both present, in that order within the entry -- our declared
# schema, see contracts/exception-mechanisms.md; reason is optional but
# expected). An entry missing key or expires emits nothing for that record,
# which is what makes a malformed entry fail closed by construction, not by
# an extra check.
records="$(awk '
  /^[[:space:]]*-[[:space:]]*key:/ {
    if (have_key) print key "\t" reason "\t" expires
    sub(/^[[:space:]]*-[[:space:]]*key:[[:space:]]*/, "")
    key = $0
    gsub(/^["'"'"']|["'"'"']$/, "", key)
    have_key = 1
    reason = ""
    expires = ""
    next
  }
  /^[[:space:]]*reason:/ {
    sub(/^[[:space:]]*reason:[[:space:]]*/, "")
    reason = $0
    gsub(/^["'"'"']|["'"'"']$/, "", reason)
    next
  }
  /^[[:space:]]*expires:/ {
    sub(/^[[:space:]]*expires:[[:space:]]*/, "")
    expires = $0
    gsub(/^["'"'"']|["'"'"']$/, "", expires)
    next
  }
  END { if (have_key) print key "\t" reason "\t" expires }
' "$EXCEPTIONS_FILE")"

TODAY="$(date -u +%F)"
applied=0

while IFS=$'\t' read -r key reason expires; do
  [[ -n "$key" ]] || continue
  [[ -n "$expires" ]] || continue
  [[ "$expires" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || continue
  [[ "$expires" < "$TODAY" ]] && continue

  # transitionKey: SonarCloud's "accept this risk" status transition value.
  # The endpoint/host/body SHAPE are verified (see header); this specific
  # enum value is not -- T036 still applies to it specifically.
  body="$(jq -n --arg key "$key" --arg reason "${reason:-Accepted via apply-sca-exceptions.sh}" \
    '{issueReleaseKey: $key, transitionKey: "ACCEPT", comment: $reason}')"

  raw="$(curl -sS -w '\n%{http_code}' -X POST \
    -H "Authorization: Bearer ${SONAR_ADMIN_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$body" \
    "${SONAR_API_HOST}/sca/issues-releases/change-status")"
  split_status "$raw"

  [[ "$HTTP_STATUS" == "200" || "$HTTP_STATUS" == "204" ]] \
    || fail "dependency-risk transition failed for ${key} (HTTP $HTTP_STATUS): $HTTP_BODY -- an exception a maintainer configured must apply or visibly fail, never silently skip"

  log_action exception_applied "$key"
  applied=$((applied + 1))
done <<<"$records"

[[ "$applied" -gt 0 ]] || log_action no_op "sca-exceptions"
