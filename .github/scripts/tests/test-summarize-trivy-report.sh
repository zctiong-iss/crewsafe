#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/.github/scripts/security/summarize-trivy-report.sh"
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

report="$WORK/report.json"
summary="$WORK/summary.md"

printf 'test-summarize-trivy-report\n'
cat >"$report" <<'JSON'
{"Results":[{"Vulnerabilities":[{"VulnerabilityID":"CVE-2026-10001","Severity":"HIGH","PkgName":"unsafe|package<script>","InstalledVersion":"1.0.0","FixedVersion":"1.0.1","Description":"unsafe-description-content"}]}]}
JSON
expect 0 'summarizes valid report' "$SCRIPT" "$report" "$summary" 'crewsafe/ml-service:test' 'abc123'
content="$(cat "$summary" 2>/dev/null || true)"
TESTS_RUN=$((TESTS_RUN + 1))
if [[ "$content" == *'CVE-2026-10001'* ]]; then pass 'summary contains advisory ID'; else fail 'summary contains advisory ID'; fi
TESTS_RUN=$((TESTS_RUN + 1))
if [[ "$content" != *'unsafe-description-content'* ]]; then
  pass 'summary excludes unsafe raw description'
else
  fail 'summary excludes unsafe raw description'
fi
TESTS_RUN=$((TESTS_RUN + 1))
if [[ "$content" != *'<script>'* ]]; then
  pass 'summary sanitizes unsafe package metadata'
else
  fail 'summary sanitizes unsafe package metadata'
fi

printf '{not-json}\n' >"$report"
expect 1 'rejects invalid JSON' "$SCRIPT" "$report" "$summary" 'image' 'revision'

: >"$report"
expect 1 'rejects empty report' "$SCRIPT" "$report" "$summary" 'image' 'revision'

expect 1 'rejects missing report' "$SCRIPT" "$WORK/missing.json" "$summary" 'image' 'revision'

printf '%s tests, %s failed\n' "$TESTS_RUN" "$TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]
