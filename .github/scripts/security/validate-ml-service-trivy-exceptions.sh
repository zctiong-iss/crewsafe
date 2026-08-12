#!/usr/bin/env bash
# Validate the ML-service's reviewed Trivy exception source before the shared
# expiry filter derives its runtime-only ignorefile.
set -euo pipefail

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

[[ $# -eq 1 ]] || fail "usage: validate-ml-service-trivy-exceptions.sh <source-file>"
SOURCE_FILE="$1"
[[ -f "$SOURCE_FILE" ]] || fail "source ignorefile not found: $SOURCE_FILE"

date_normalized() {
  local value="$1"
  if date -u -d "$value" +%F >/dev/null 2>&1; then
    date -u -d "$value" +%F
  else
    date -ju -f '%Y-%m-%d' "$value" +%F 2>/dev/null
  fi
}

TODAY="$(date -u +%F)"
line_number=0

while IFS= read -r line || [[ -n "$line" ]]; do
  line_number=$((line_number + 1))
  [[ "$line" =~ ^[[:space:]]*$ || "$line" =~ ^[[:space:]]*# ]] && continue

  advisory_id="$(awk '{print $1}' <<<"$line")"
  [[ "$advisory_id" =~ ^CVE-[0-9]{4}-[0-9]+$ || "$advisory_id" =~ ^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$ ]] \
    || fail "line $line_number has an unsupported advisory identifier"
  [[ "$line" =~ owner:[^[:space:]#]+ ]] || fail "line $line_number is missing owner:"
  [[ "$line" =~ reason:[^[:space:]#] ]] || fail "line $line_number is missing reason:"

  exp_date=""
  if [[ "$line" =~ exp:([0-9]{4}-[0-9]{2}-[0-9]{2}) ]]; then
    exp_date="${BASH_REMATCH[1]}"
  fi
  [[ -n "$exp_date" ]] || fail "line $line_number is missing exp:YYYY-MM-DD"
  [[ "$(date_normalized "$exp_date" || true)" == "$exp_date" ]] \
    || fail "line $line_number has an invalid expiry date"
  [[ "$exp_date" < "$TODAY" ]] && fail "line $line_number has expired"
done <"$SOURCE_FILE"

exit 0
