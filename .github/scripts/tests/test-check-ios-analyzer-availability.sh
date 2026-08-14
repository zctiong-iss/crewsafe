#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/.github/scripts/mobsf-dynamic/check-ios-analyzer-availability.sh"
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

printf 'test-check-ios-analyzer-availability\n'

stub_bin="$WORK/bin"
mkdir -p "$stub_bin"

# A fake `idevice_id` controlling whether a physical device UDID is "connected".
cat >"$stub_bin/idevice_id" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${IDEVICE_ID_STUB_CONNECTED:-0}" == 1 ]]; then
  echo "${IOS_DEVICE_UDID:-stub-udid}"
fi
STUB
chmod +x "$stub_bin/idevice_id"

export PATH="$stub_bin:$PATH"

reset_env() {
  unset MOBSF_CORELLIUM_API_DOMAIN MOBSF_CORELLIUM_API_KEY MOBSF_CORELLIUM_PROJECT_ID IOS_DEVICE_UDID IDEVICE_ID_STUB_CONNECTED || true
}

# --- Neither Corellium nor a device is configured: fails closed ---
reset_env
out1="$WORK/env1.sh"
expect 1 'exits non-zero when neither Corellium nor a device is configured' "$SCRIPT" "$out1"
TESTS_RUN=$((TESTS_RUN + 1))
if [[ ! -e "$out1" ]]; then
  pass 'writes nothing when nothing is provisioned'
else
  fail 'writes nothing when nothing is provisioned'
fi
stderr1="$("$SCRIPT" "$WORK/env1b.sh" 2>&1 >/dev/null || true)"
TESTS_RUN=$((TESTS_RUN + 1))
if [[ "$stderr1" == *"not provisioned"* ]]; then
  pass 'reports a clear "not provisioned" message'
else
  fail 'reports a clear "not provisioned" message'
fi

# --- Only MOBSF_CORELLIUM_API_DOMAIN set (API key missing): still fails closed ---
reset_env
export MOBSF_CORELLIUM_API_DOMAIN='fake.corellium.example'
out1c="$WORK/env1c.sh"
expect 1 'exits non-zero when only the Corellium domain is set (key missing)' "$SCRIPT" "$out1c"

# --- Both required Corellium env vars present: reports ios-corellium ---
reset_env
export MOBSF_CORELLIUM_API_DOMAIN='fake.corellium.example'
export MOBSF_CORELLIUM_API_KEY='fake-corellium-key'
out2="$WORK/env2.sh"
expect 0 'exits 0 when both required Corellium env vars are present' "$SCRIPT" "$out2"
TESTS_RUN=$((TESTS_RUN + 1))
if grep -q '^analyzer_environment=ios-corellium$' "$out2" 2>/dev/null; then
  pass 'reports analyzer_environment=ios-corellium'
else
  fail 'reports analyzer_environment=ios-corellium'
fi
TESTS_RUN=$((TESTS_RUN + 1))
stdout_stderr2="$("$SCRIPT" "$WORK/env2b.sh" 2>&1 || true)"
if [[ "$stdout_stderr2" != *'fake-corellium-key'* ]]; then
  pass 'never echoes the Corellium API key value'
else
  fail 'never echoes the Corellium API key value'
fi

# --- No Corellium config, but a physical device UDID is connected on this runner: reports
#     ios-signed-device ---
reset_env
export IOS_DEVICE_UDID='real-device-udid'
export IDEVICE_ID_STUB_CONNECTED=1
out4="$WORK/env4.sh"
expect 0 'exits 0 when a physical device UDID is connected' "$SCRIPT" "$out4"
TESTS_RUN=$((TESTS_RUN + 1))
if grep -q '^analyzer_environment=ios-signed-device$' "$out4" 2>/dev/null; then
  pass 'reports analyzer_environment=ios-signed-device'
else
  fail 'reports analyzer_environment=ios-signed-device'
fi

# --- IOS_DEVICE_UDID is set but the device is not actually connected: fails closed ---
reset_env
export IOS_DEVICE_UDID='real-device-udid'
export IDEVICE_ID_STUB_CONNECTED=0
out5="$WORK/env5.sh"
expect 1 'exits non-zero when IOS_DEVICE_UDID is set but not actually connected' "$SCRIPT" "$out5"

printf '\n%d run, %d failed\n' "$TESTS_RUN" "$TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]
