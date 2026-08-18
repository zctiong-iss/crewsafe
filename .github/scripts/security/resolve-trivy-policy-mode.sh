#!/usr/bin/env bash
# Resolve the temporary SCRUM-455 Trivy finding policy.
# Production calls use the runner's UTC date; tests may provide one explicit
# --as-of date so the expiry boundary remains deterministic.
set -euo pipefail

fail() {
  local message="$1"
  printf 'ERROR: %s\n' "$message" >&2
  exit 1
}

readonly POLICY_OWNER='CrewSafe security team'
readonly POLICY_EXPIRY='2026-09-17'

is_valid_iso_date() {
  local value="$1" normalized
  [[ "$value" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || return 1

  if normalized="$(date -u -d "$value" +%F 2>/dev/null)" && [[ "$normalized" == "$value" ]]; then
    return 0
  fi
  if normalized="$(date -ju -f '%Y-%m-%d' "$value" +%F 2>/dev/null)" && [[ "$normalized" == "$value" ]]; then
    return 0
  fi
  return 1
}

case "$#" in
  0)
    evaluated_on="$(date -u +%F)"
    ;;
  2)
    [[ "$1" == '--as-of' ]] || fail 'usage: resolve-trivy-policy-mode.sh [--as-of YYYY-MM-DD]'
    evaluated_on="$2"
    ;;
  *)
    fail 'usage: resolve-trivy-policy-mode.sh [--as-of YYYY-MM-DD]'
    ;;
esac

is_valid_iso_date "$evaluated_on" || fail 'evaluated date must be a valid YYYY-MM-DD date'
is_valid_iso_date "$POLICY_EXPIRY" || fail 'configured policy expiry is invalid'

if [[ "$evaluated_on" > "$POLICY_EXPIRY" ]]; then
  mode='blocking'
  exit_code='1'
else
  mode='report-only'
  exit_code='0'
fi

write_output() {
  local line="$1"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf '%s\n' "$line" >>"$GITHUB_OUTPUT"
  else
    printf '%s\n' "$line"
  fi
}

write_output "mode=$mode"
write_output "exit_code=$exit_code"
write_output "owner=$POLICY_OWNER"
write_output "expires=$POLICY_EXPIRY"
write_output "evaluated_on=$evaluated_on"
