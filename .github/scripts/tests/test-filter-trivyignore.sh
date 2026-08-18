#!/usr/bin/env bash
set -euo pipefail

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/harness.sh"

SCRIPT="$REPO_ROOT/.github/scripts/security/filter-trivyignore.sh"

printf 'test-filter-trivyignore\n'
require_executable "$SCRIPT" "Trivy ignorefile expiry filter"

# write_source <dir> <lines...> -- writes a source ignorefile with the given lines.
write_source() {
  local dir="$1"
  shift
  local f="$dir/source.trivyignore"
  printf '%s\n' "$@" >"$f"
  printf '%s' "$f"
}

# --- User Story 3 (T025): expiry filtering, malformed handling --------------
# SCRUM-455: report-only mode keeps valid HIGH/CRITICAL findings visible; this
# helper only materializes exact, currently valid exception identifiers. It
# must not turn a report-only finding into an implicit clean decision.

work="$(make_tmpdir)"
future="$(date -u -d '+30 days' +%F 2>/dev/null || date -u -v+30d +%F)"
past="$(date -u -d '-1 day' +%F 2>/dev/null || date -u -v-1d +%F)"

# AS: one non-expired, one expired, one malformed (no exp:) -- only the
# non-expired CVE id survives, and the comment annotation is stripped.
src="$(write_source "$work" \
  "# header comment, not a data line" \
  "CVE-2024-11111  # exp:${future} reason:tracked, non-expired" \
  "CVE-2024-22222  # exp:${past} reason:expired, must not suppress" \
  "CVE-2024-33333  # reason:missing exp date entirely, must fail closed")"
out="$work/active.trivyignore"
"$SCRIPT" "$src" "$out"

assert_exit 0 "filter runs successfully on a mixed fixture" "$SCRIPT" "$src" "$out"
result="$(cat "$out")"
assert_contains "$result" "CVE-2024-11111" "non-expired entry survives filtering"
assert_not_contains "$result" "CVE-2024-22222" "expired entry is dropped"
assert_not_contains "$result" "CVE-2024-33333" "entry missing exp: is dropped (fail closed)"
assert_not_contains "$result" "exp:" "surviving entries have the exp:/reason: comment stripped"
assert_not_contains "$result" "reason:" "surviving entries have the exp:/reason: comment stripped"

# AS (US3 Scenario 2 / T027): the SAME entry, once its exp: date is in the
# past, is excluded on the next run with no other input change.
src2="$(write_source "$work" "CVE-2024-44444  # exp:${past} reason:now expired")"
out2="$work/active2.trivyignore"
"$SCRIPT" "$src2" "$out2"
assert_not_contains "$(cat "$out2")" "CVE-2024-44444" "expired-by-date entry excluded on the next run (expiry-by-exclusion)"

# Empty/whitespace-only source -> empty, valid output, exit 0.
empty_src="$(write_source "$work" "")"
empty_out="$work/empty.trivyignore"
assert_exit 0 "filter handles an empty source file" "$SCRIPT" "$empty_src" "$empty_out"

finish
