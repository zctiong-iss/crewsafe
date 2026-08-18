#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/.github/scripts/security/summarize-trivy-report.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM
TESTS_RUN=0
TESTS_FAILED=0
readonly TEST_REVISION='revision'
readonly BACKEND_IMAGE_REF='backend/image:sha'

pass() { local label="$1"; printf '  ok   %s\n' "$label"; }
fail() { local label="$1"; printf '  FAIL %s\n' "$label"; TESTS_FAILED=$((TESTS_FAILED + 1)); }
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
exceptions="$WORK/active.trivyignore"

printf 'test-summarize-trivy-report\n'
cat >"$report" <<'JSON'
{"ArtifactName":"crewsafe/ml-service:test","ArtifactType":"container_image","Results":[{"Vulnerabilities":[{"VulnerabilityID":"CVE-2026-10001","Severity":"HIGH","PkgName":"unsafe|package<script>","InstalledVersion":"1.0.0","FixedVersion":"1.0.1","Description":"unsafe-description-content"}]}]}
JSON
printf '%s\n' 'CVE-2026-10001' >"$exceptions"
expect 0 'summarizes valid report' "$SCRIPT" "$report" "$summary" 'crewsafe/ml-service:test' 'abc123' 'ML-service container vulnerability scan' "$exceptions"
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
TESTS_RUN=$((TESTS_RUN + 1))
if [[ "$content" == *'Decision: BLOCKED'* ]]; then
  pass 'summary records blocked decision'
else
  fail 'summary records blocked decision'
fi
TESTS_RUN=$((TESTS_RUN + 1))
if [[ "$content" == *'Active exception identifiers supplied to scan:'* && "$content" == *'CVE-2026-10001'* ]]; then
  pass 'summary records active exception identifiers'
else
  fail 'summary records active exception identifiers'
fi

sed "s#crewsafe/ml-service:test#$BACKEND_IMAGE_REF#g" "$report" >"$report.next"
mv "$report.next" "$report"
expect 0 'accepts the backend summary title' "$SCRIPT" "$report" "$summary" "$BACKEND_IMAGE_REF" 'def456' 'Backend image vulnerability scan' "$exceptions"
content="$(cat "$summary" 2>/dev/null || true)"
TESTS_RUN=$((TESTS_RUN + 1))
if [[ "$content" == *'## Backend image vulnerability scan'* ]]; then
  pass 'summary uses the backend title'
else
  fail 'summary uses the backend title'
fi

expect 1 'rejects an unsupported summary title' "$SCRIPT" "$report" "$summary" 'image' "$TEST_REVISION" 'Untrusted title'

sed "s#$BACKEND_IMAGE_REF#another/image:sha#g" "$report" >"$report.next"
mv "$report.next" "$report"
expect 1 'rejects an image mismatch' "$SCRIPT" "$report" "$summary" "$BACKEND_IMAGE_REF" "$TEST_REVISION"

sed "s#another/image:sha#$BACKEND_IMAGE_REF#g; s#container_image#filesystem#g" "$report" >"$report.next"
mv "$report.next" "$report"
expect 1 'rejects an artifact type mismatch' "$SCRIPT" "$report" "$summary" "$BACKEND_IMAGE_REF" "$TEST_REVISION"

printf '{"ArtifactType":"container_image","Results":[]}\n' >"$report"
expect 1 'rejects missing artifact name' "$SCRIPT" "$report" "$summary" "$BACKEND_IMAGE_REF" "$TEST_REVISION"

printf '{"ArtifactName":"%s","ArtifactType":"container_image"}\n' "$BACKEND_IMAGE_REF" >"$report"
expect 1 'rejects missing results array' "$SCRIPT" "$report" "$summary" "$BACKEND_IMAGE_REF" "$TEST_REVISION"

printf '{"ArtifactName":"%s","ArtifactType":"container_image","Results":[]}\n' "$BACKEND_IMAGE_REF" >"$report"
expect 0 'accepts clean report' "$SCRIPT" "$report" "$summary" "$BACKEND_IMAGE_REF" "$TEST_REVISION"
content="$(cat "$summary" 2>/dev/null || true)"
TESTS_RUN=$((TESTS_RUN + 1))
if [[ "$content" == *'HIGH/CRITICAL findings:'* && "$content" == *'Decision: APPROVED'* ]]; then
  pass 'clean report records approved decision'
else
  fail 'clean report records approved decision'
fi

printf '{"ArtifactName":"%s","ArtifactType":"container_image","Results":[]}\n' "$BACKEND_IMAGE_REF" >"$report"
printf 'not-an-advisory\n' >"$exceptions"
expect 1 'rejects unsafe active exception identifier' "$SCRIPT" "$report" "$summary" "$BACKEND_IMAGE_REF" "$TEST_REVISION" 'Backend image vulnerability scan' "$exceptions"

printf '{not-json}\n' >"$report"
expect 1 'rejects invalid JSON' "$SCRIPT" "$report" "$summary" 'image' "$TEST_REVISION"

: >"$report"
expect 1 'rejects empty report' "$SCRIPT" "$report" "$summary" 'image' "$TEST_REVISION"

expect 1 'rejects missing report' "$SCRIPT" "$WORK/missing.json" "$summary" 'image' "$TEST_REVISION"

printf '%s tests, %s failed\n' "$TESTS_RUN" "$TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]
