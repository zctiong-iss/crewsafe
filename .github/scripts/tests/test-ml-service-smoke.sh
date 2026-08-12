#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/.github/scripts/ci/run-ml-service-smoke.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM
BIN="$WORK/bin"
mkdir -p "$BIN"
TESTS_RUN=0
TESTS_FAILED=0

pass() { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; TESTS_FAILED=$((TESTS_FAILED + 1)); }

cat >"$BIN/docker" <<'DOCKER'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$TEST_LOG"
case "$1" in
  run) [[ "${SMOKE_STUB_MODE:-healthy}" == crash ]] && exit 1; echo container-id ;;
  port) echo '127.0.0.1:18000' ;;
  inspect) [[ "${SMOKE_STUB_MODE:-healthy}" == root ]] && echo root || echo appuser ;;
  exec) [[ "${SMOKE_STUB_MODE:-healthy}" == writable ]] && exit 1 || exit 0 ;;
  rm) exit 0 ;;
  *) exit 0 ;;
esac
DOCKER
cat >"$BIN/curl" <<'CURL'
#!/usr/bin/env bash
set -euo pipefail
url="${!#}"
case "${SMOKE_STUB_MODE:-healthy}:$url" in
  health-bad:*/health) exit 28 ;;
  */health) printf '%s\n' '{"status":"ok"}' ;;
  malformed:*/forecast) printf '%s\n' '{"metric":"wbgt"}' ;;
  forecast-timeout:*/forecast) exit 28 ;;
  */forecast) printf '%s\n' '{"metric":"wbgt","predicted_value":35.5,"horizon_minutes":30,"model_version":"baseline-1.0.0","confidence_interval_lower":34.0,"confidence_interval_upper":37.0,"timestamp":"2026-01-01T00:00:00Z"}' ;;
  *) exit 1 ;;
esac
CURL
chmod +x "$BIN/docker" "$BIN/curl"

run_helper() {
  local mode="$1"
  local jq_directory
  jq_directory="$(dirname "$(command -v jq)")"
  env TEST_LOG="$WORK/docker-$mode.log" \
    SMOKE_STUB_MODE="$mode" \
    SMOKE_RETRIES=1 \
    SMOKE_RETRY_DELAY=0 \
    AWS_ACCESS_KEY_ID=not-a-real-key \
    PATH="$BIN:$jq_directory:/usr/bin:/bin" \
    "$SCRIPT" crewsafe-ml-service:test >/dev/null 2>&1
}

expect() {
  local expected="$1" label="$2" mode="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  local actual=0
  run_helper "$mode" || actual=$?
  if [[ "$actual" == "$expected" ]]; then pass "$label"; else fail "$label"; fi
}

printf 'test-ml-service-smoke\n'
expect 0 'healthy image passes smoke contract' healthy
expect 1 'container crash fails smoke' crash
expect 1 'root runtime fails smoke' root
expect 1 'writable requirements manifest fails smoke' writable
expect 1 'malformed forecast response fails smoke' malformed
expect 1 'forecast timeout fails smoke' forecast-timeout
expect 1 'health timeout fails smoke' health-bad

log="$(cat "$WORK/docker-healthy.log" 2>/dev/null || true)"
TESTS_RUN=$((TESTS_RUN + 1))
if [[ "$log" == *'rm -f'* ]]; then pass 'cleanup removes container'; else fail 'cleanup removes container'; fi
TESTS_RUN=$((TESTS_RUN + 1))
if [[ "$log" == *'AWS_EC2_METADATA_DISABLED=true'* && "$log" != *'AWS_ACCESS_KEY_ID'* ]]; then
  pass 'Docker run disables metadata and receives no credential variable'
else
  fail 'Docker run disables metadata and receives no credential variable'
fi

printf '%s tests, %s failed\n' "$TESTS_RUN" "$TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]
