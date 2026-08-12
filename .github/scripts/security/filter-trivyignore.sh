#!/usr/bin/env bash
# Filter a version-controlled Trivy ignorefile source (with inline expiry
# annotations) down to an "active" ignorefile Trivy actually consumes
# (SCRUM-269, User Story 3, FR-007/FR-008).
#
# Source line format: "<CVE-ID>  # exp:<YYYY-MM-DD> reason:<free text>".
# Lines with no `exp:` date, an unparsable date, or a past date are dropped
# from the output -- never included. This is what makes FR-008 ("an expired
# exception no longer suppresses its finding") true by construction: an
# expired or malformed entry simply never reaches Trivy, rather than Trivy
# (or this script) needing separate expiry-aware logic at scan time. See
# specs/020-ci-vulnerability-scan-gates/contracts/exception-mechanisms.md.
#
# Usage: filter-trivyignore.sh <source-file> <output-file>
set -euo pipefail

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

[[ $# -eq 2 ]] || fail "usage: filter-trivyignore.sh <source-file> <output-file>"
SOURCE_FILE="$1"
OUTPUT_FILE="$2"

[[ -f "$SOURCE_FILE" ]] || fail "source ignorefile not found: $SOURCE_FILE"

TODAY="$(date -u +%F)"

: >"$OUTPUT_FILE"

while IFS= read -r line || [[ -n "$line" ]]; do
  # Blank lines and pure comment lines (no leading CVE id) are not data.
  [[ "$line" =~ ^[[:space:]]*$ ]] && continue
  [[ "$line" =~ ^[[:space:]]*# ]] && continue

  cve_id="$(awk '{print $1}' <<<"$line")"
  [[ -n "$cve_id" ]] || continue

  # Extract exp:<date> if present; a missing or unparsable date fails closed
  # (the entry is dropped, reverting to blocking, not silently exempted).
  exp_date=""
  if [[ "$line" =~ exp:([0-9]{4}-[0-9]{2}-[0-9]{2}) ]]; then
    exp_date="${BASH_REMATCH[1]}"
  fi
  if [[ -z "$exp_date" ]]; then
    continue
  fi

  # ISO 8601 (YYYY-MM-DD) dates compare correctly as plain strings.
  if [[ "$exp_date" < "$TODAY" ]]; then
    continue
  fi

  printf '%s\n' "$cve_id" >>"$OUTPUT_FILE"
done <"$SOURCE_FILE"
