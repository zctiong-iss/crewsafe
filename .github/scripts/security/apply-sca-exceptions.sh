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
# Usage: apply-sca-exceptions.sh <exceptions-file>
set -euo pipefail

SONAR_HOST="https://sonarcloud.io"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

log_action() {
  printf 'RUN_REPORT action=%s target=%s\n' "$1" "$2"
}

[[ $# -eq 1 ]] || fail "usage: apply-sca-exceptions.sh <exceptions-file>"
EXCEPTIONS_FILE="$1"
[[ -f "$EXCEPTIONS_FILE" ]] || fail "exceptions file not found: $EXCEPTIONS_FILE"
[[ -n "${SONAR_ADMIN_TOKEN:-}" ]] || fail "SONAR_ADMIN_TOKEN is not set"

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

# Emit one "<key>\t<expires>" record per well-formed entry (key AND expires
# both present, in that order within the entry -- our declared schema, see
# contracts/exception-mechanisms.md). An entry missing either field emits
# nothing for that record, which is what makes a malformed entry fail closed
# by construction, not by an extra check.
records="$(awk '
  /^[[:space:]]*-[[:space:]]*key:/ {
    if (have_key) print key "\t" expires
    sub(/^[[:space:]]*-[[:space:]]*key:[[:space:]]*/, "")
    key = $0
    gsub(/^["'"'"']|["'"'"']$/, "", key)
    have_key = 1
    expires = ""
    next
  }
  /^[[:space:]]*expires:/ {
    sub(/^[[:space:]]*expires:[[:space:]]*/, "")
    expires = $0
    gsub(/^["'"'"']|["'"'"']$/, "", expires)
    next
  }
  END { if (have_key) print key "\t" expires }
' "$EXCEPTIONS_FILE")"

TODAY="$(date -u +%F)"
applied=0

while IFS=$'\t' read -r key expires; do
  [[ -n "$key" ]] || continue
  [[ -n "$expires" ]] || continue
  [[ "$expires" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || continue
  [[ "$expires" < "$TODAY" ]] && continue

  raw="$(curl -sS -w '\n%{http_code}' -X POST \
    -H "Authorization: Bearer ${SONAR_ADMIN_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"ACCEPT\"}" \
    "${SONAR_HOST}/api/v2/sca/issues-releases/${key}/transition?organization=${SONAR_ORG}&projectKey=${SONAR_PROJECT_KEY}")"
  split_status "$raw"

  [[ "$HTTP_STATUS" == "200" || "$HTTP_STATUS" == "204" ]] \
    || fail "dependency-risk transition failed for ${key} (HTTP $HTTP_STATUS): $HTTP_BODY -- an exception a maintainer configured must apply or visibly fail, never silently skip"

  log_action exception_applied "$key"
  applied=$((applied + 1))
done <<<"$records"

[[ "$applied" -gt 0 ]] || log_action no_op "sca-exceptions"
