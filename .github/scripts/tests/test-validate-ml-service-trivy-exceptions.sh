#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/.github/scripts/security/validate-ml-service-trivy-exceptions.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM
TESTS_RUN=0
TESTS_FAILED=0

pass() { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; TESTS_FAILED=$((TESTS_FAILED + 1)); }
expect() {
  local expected="$1" label="$2"
  shift 2
  TESTS_RUN=$((TESTS_RUN + 1))
  local actual=0
  "$@" >/dev/null 2>&1 || actual=$?
  if [[ "$actual" == "$expected" ]]; then pass "$label"; else fail "$label"; fi
}

future="$(date -u -d '+30 days' +%F 2>/dev/null || date -u -v+30d +%F)"
past="$(date -u -d '-1 day' +%F 2>/dev/null || date -u -v-1d +%F)"
write_fixture() { printf '%s\n' "$@" >"$WORK/source"; }

printf 'test-validate-ml-service-trivy-exceptions\n'
write_fixture "CVE-2026-10001  # owner:security-team exp:${future} reason:tracked-risk"
expect 0 'accepts a complete future exception' "$SCRIPT" "$WORK/source"

write_fixture "CVE-2026-10001  # owner:security-team exp:${past} reason:expired-risk"
expect 1 'rejects expired exception' "$SCRIPT" "$WORK/source"

write_fixture "CVE-2026-10001  # exp:${future} reason:missing-owner"
expect 1 'rejects exception missing owner' "$SCRIPT" "$WORK/source"

write_fixture "CVE-2026-10001  # owner:security-team exp:${future}"
expect 1 'rejects exception missing reason' "$SCRIPT" "$WORK/source"

write_fixture "CVE-2026-10001  # owner:security-team exp:${future} reason:#"
expect 1 'rejects exception with empty reason marker' "$SCRIPT" "$WORK/source"

write_fixture "not-an-advisory  # owner:security-team exp:${future} reason:bad-id"
expect 1 'rejects unsupported advisory identifier' "$SCRIPT" "$WORK/source"

write_fixture "CVE-2026-10001  # owner:security-team exp:not-a-date reason:bad-date"
expect 1 'rejects malformed expiry' "$SCRIPT" "$WORK/source"

printf '%s tests, %s failed\n' "$TESTS_RUN" "$TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]
