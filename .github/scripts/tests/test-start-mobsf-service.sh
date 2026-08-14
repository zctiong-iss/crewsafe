#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/.github/scripts/mobsf-dynamic/start-mobsf-service.sh"
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

printf 'test-start-mobsf-service\n'

# Fake `docker` and `curl` on PATH, mirroring the stub-aws.sh convention: behavior controlled
# by env vars, calls logged for assertions, and it is what makes this test fast/offline (no
# real container or network call is ever made).
stub_bin="$WORK/bin"
mkdir -p "$stub_bin"
cat >"$stub_bin/docker" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$DOCKER_STUB_LOG"
case "$1" in
  run)
    if [[ "${DOCKER_STUB_RUN_FAIL:-0}" == 1 ]]; then
      echo "docker: stub run failure" >&2
      exit 1
    fi
    echo "${DOCKER_STUB_CONTAINER_ID:-stub-container-id}"
    ;;
  rm)
    : ;;
  *)
    echo "docker: stub does not implement '$1'" >&2
    exit 1
    ;;
esac
STUB
chmod +x "$stub_bin/docker"

cat >"$stub_bin/curl" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$CURL_STUB_LOG"
if [[ "${CURL_STUB_NEVER_READY:-0}" == 1 ]]; then
  exit 22
fi
exit 0
STUB
chmod +x "$stub_bin/curl"

export PATH="$stub_bin:$PATH"
export DOCKER_STUB_LOG="$WORK/docker-calls.log"
export CURL_STUB_LOG="$WORK/curl-calls.log"
: >"$DOCKER_STUB_LOG"
: >"$CURL_STUB_LOG"
export MOBSF_IMAGE='opensecurity/mobile-security-framework-mobsf@sha256:dd1e194f5d7aec5c27c6feba8085bcfa5c56ae59f0e13b728d3a76ca354dd0ee'
export MOBSF_START_TIMEOUT_SECONDS=2
export MOBSF_START_POLL_INTERVAL_SECONDS=1

reset_docker_log() { : >"$DOCKER_STUB_LOG"; : >"$CURL_STUB_LOG"; }

# --- Happy path: container starts, readiness curl succeeds immediately ---
reset_docker_log
out1="$WORK/env1.sh"
DOCKER_STUB_CONTAINER_ID='abc123' expect 0 'exits 0 when the container starts and becomes ready' "$SCRIPT" "$out1"

TESTS_RUN=$((TESTS_RUN + 1))
if grep -q '^MOBSF_API_KEY=' "$out1" 2>/dev/null; then
  pass 'writes MOBSF_API_KEY to the output env file'
else
  fail 'writes MOBSF_API_KEY to the output env file'
fi

api_key_value="$(grep '^MOBSF_API_KEY=' "$out1" | cut -d= -f2-)"
TESTS_RUN=$((TESTS_RUN + 1))
if [[ "$api_key_value" =~ ^[0-9a-f]{64}$ ]]; then
  pass 'MOBSF_API_KEY is a 64-char lowercase-hex value'
else
  fail 'MOBSF_API_KEY is a 64-char lowercase-hex value'
fi

TESTS_RUN=$((TESTS_RUN + 1))
if grep -qF -- '--network host' "$DOCKER_STUB_LOG"; then
  pass 'docker run uses --network host (needed to reach the host ADB server)'
else
  fail 'docker run uses --network host (needed to reach the host ADB server)'
fi

TESTS_RUN=$((TESTS_RUN + 1))
if ! grep -qF -- '-p 8000:8000' "$DOCKER_STUB_LOG"; then
  pass 'does not use -p port mapping (meaningless/redundant under --network host)'
else
  fail 'does not use -p port mapping (meaningless/redundant under --network host)'
fi

# --- The API key value must never be echoed to stdout/stderr, only written to the sink ---
stdout_and_stderr="$WORK/combined-output.log"
reset_docker_log
"$SCRIPT" "$WORK/env2.sh" >"$stdout_and_stderr" 2>&1 || true
generated_key="$(grep '^MOBSF_API_KEY=' "$WORK/env2.sh" | cut -d= -f2-)"
TESTS_RUN=$((TESTS_RUN + 1))
if [[ -n "$generated_key" ]] && ! grep -qF -- "$generated_key" "$stdout_and_stderr"; then
  pass 'the generated API key value never appears in stdout/stderr'
else
  fail 'the generated API key value never appears in stdout/stderr'
fi

# --- Optional env passthrough: ANALYZER_IDENTIFIER and MOBSF_CORELLIUM_* reach the
#     container's -e flags only when set in this script's own environment ---
reset_docker_log
out3="$WORK/env3.sh"
ANALYZER_IDENTIFIER='emulator-5554' \
  MOBSF_CORELLIUM_API_DOMAIN='fake.corellium.example' \
  MOBSF_CORELLIUM_API_KEY='fake-corellium-key' \
  "$SCRIPT" "$out3" >/dev/null 2>&1
TESTS_RUN=$((TESTS_RUN + 1))
if grep -qF -- 'ANALYZER_IDENTIFIER=emulator-5554' "$DOCKER_STUB_LOG" \
  && grep -qF -- 'MOBSF_CORELLIUM_API_DOMAIN=fake.corellium.example' "$DOCKER_STUB_LOG" \
  && grep -qF -- 'MOBSF_CORELLIUM_API_KEY=fake-corellium-key' "$DOCKER_STUB_LOG"; then
  pass 'passes ANALYZER_IDENTIFIER and MOBSF_CORELLIUM_* through to the container when set'
else
  fail 'passes ANALYZER_IDENTIFIER and MOBSF_CORELLIUM_* through to the container when set'
fi

reset_docker_log
out3b="$WORK/env3b.sh"
"$SCRIPT" "$out3b" >/dev/null 2>&1
TESTS_RUN=$((TESTS_RUN + 1))
if ! grep -qF -- 'ANALYZER_IDENTIFIER' "$DOCKER_STUB_LOG"; then
  pass 'omits ANALYZER_IDENTIFIER entirely when not set (no empty -e flag)'
else
  fail 'omits ANALYZER_IDENTIFIER entirely when not set (no empty -e flag)'
fi

# --- docker run failing to start the container fails closed ---
reset_docker_log
out4="$WORK/env4.sh"
DOCKER_STUB_RUN_FAIL=1 expect 1 'exits non-zero when the container fails to start' "$SCRIPT" "$out4"
TESTS_RUN=$((TESTS_RUN + 1))
if [[ ! -e "$out4" ]]; then
  pass 'writes nothing to the output env file when the container fails to start'
else
  fail 'writes nothing to the output env file when the container fails to start'
fi

# --- Readiness never appearing within the bounded timeout fails closed ---
reset_docker_log
out5="$WORK/env5.sh"
CURL_STUB_NEVER_READY=1 expect 1 'exits non-zero when the API never becomes ready within the timeout' "$SCRIPT" "$out5"
TESTS_RUN=$((TESTS_RUN + 1))
if [[ ! -e "$out5" ]]; then
  pass 'writes nothing to the output env file on a readiness timeout'
else
  fail 'writes nothing to the output env file on a readiness timeout'
fi

printf '\n%d run, %d failed\n' "$TESTS_RUN" "$TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]
