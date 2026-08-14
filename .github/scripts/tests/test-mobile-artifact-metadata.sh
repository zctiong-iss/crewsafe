#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/.github/scripts/mobile/write-artifact-metadata.sh"
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
run_with_env() {
  # run_with_env <metadata_path> <summary_path> [env assignments already exported by caller]
  "$SCRIPT" "$1" "$2"
}

printf 'test-mobile-artifact-metadata\n'

required_env() {
  export PLATFORM=android
  export ARTIFACT_TYPE=apk
  export BUILD_PROFILE=android-internal
  export APP_VERSION=1.0.0
  export COMMIT_SHA=8f3c2e1a9b7d4f6c0a1b2c3d4e5f6a7b8c9d0e1f
  export RUN_ID=1234567890
  export RUN_URL='https://github.com/org/repo/actions/runs/1234567890'
  export TRIGGERED_BY=zctiong-iss
}
unset_all_env() {
  unset PLATFORM ARTIFACT_TYPE BUILD_PROFILE APP_VERSION COMMIT_SHA RUN_ID RUN_URL TRIGGERED_BY || true
}

# --- Happy path: all required env vars present ---
unset_all_env
required_env
metadata="$WORK/metadata.json"
summary="$WORK/summary.md"
expect 0 'exits 0 with all required env vars set' run_with_env "$metadata" "$summary"

TESTS_RUN=$((TESTS_RUN + 1))
if [[ -f "$metadata" ]]; then pass 'writes the metadata file'; else fail 'writes the metadata file'; fi

metadata_content="$(cat "$metadata" 2>/dev/null || true)"
for needle in \
  '"platform": "android"' \
  '"artifact_type": "apk"' \
  '"build_profile": "android-internal"' \
  '"app_version": "1.0.0"' \
  '"commit_sha": "8f3c2e1a9b7d4f6c0a1b2c3d4e5f6a7b8c9d0e1f"' \
  '"run_id": "1234567890"' \
  '"run_url": "https://github.com/org/repo/actions/runs/1234567890"' \
  '"triggered_by": "zctiong-iss"'
do
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ "$metadata_content" == *"$needle"* ]]; then
    pass "metadata contains $needle"
  else
    fail "metadata contains $needle"
  fi
done

TESTS_RUN=$((TESTS_RUN + 1))
if python3 -c "import json,sys; json.load(open('$metadata'))" 2>/dev/null; then
  pass 'metadata file is valid JSON'
else
  fail 'metadata file is valid JSON'
fi

summary_content="$(cat "$summary" 2>/dev/null || true)"
for needle in 'android' 'apk' 'android-internal' '1.0.0' '8f3c2e1a9b7d4f6c0a1b2c3d4e5f6a7b8c9d0e1f'; do
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ "$summary_content" == *"$needle"* ]]; then
    pass "summary contains $needle"
  else
    fail "summary contains $needle"
  fi
done

# --- Append behavior: a second call must not clobber the first block ---
export PLATFORM=ios
export ARTIFACT_TYPE=simulator-app
export BUILD_PROFILE=ios-simulator
metadata2="$WORK/metadata2.json"
expect 0 'second call (different platform) exits 0' run_with_env "$metadata2" "$summary"
summary_content="$(cat "$summary" 2>/dev/null || true)"
TESTS_RUN=$((TESTS_RUN + 1))
if [[ "$summary_content" == *'android'* && "$summary_content" == *'ios'* ]]; then
  pass 'summary file accumulates across multiple calls (append, not overwrite)'
else
  fail 'summary file accumulates across multiple calls (append, not overwrite)'
fi

# --- Missing/empty required env vars fail closed ---
for var in PLATFORM ARTIFACT_TYPE BUILD_PROFILE APP_VERSION COMMIT_SHA RUN_ID RUN_URL TRIGGERED_BY; do
  unset_all_env
  required_env
  export "$var"=""
  expect 1 "exits 1 when \$$var is empty" run_with_env "$WORK/missing-$var.json" "$WORK/missing-$var-summary.md"
done

unset_all_env
required_env
unset PLATFORM
expect 1 'exits 1 when a required env var is entirely unset' run_with_env "$WORK/unset.json" "$WORK/unset-summary.md"

# --- The script's own source never contains a hardcoded secret-shaped literal ---
TESTS_RUN=$((TESTS_RUN + 1))
if ! rg -q -i 'BEGIN (RSA |EC )?PRIVATE KEY|BEGIN CERTIFICATE' "$SCRIPT" 2>/dev/null; then
  pass 'script source contains no hardcoded certificate/key material'
else
  fail 'script source contains no hardcoded certificate/key material'
fi

printf '\n%d run, %d failed\n' "$TESTS_RUN" "$TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]
