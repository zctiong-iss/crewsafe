#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/.github/scripts/mobsf-dynamic/retrieve-and-verify-artifact.sh"
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

printf 'test-retrieve-and-verify-artifact\n'

VALID_SHA="8f3c2e1a9b7d4f6c0a1b2c3d4e5f6a7b8c9d0e1f"

make_valid_fixture() {
  local dir="$1"
  mkdir -p "$dir"
  cat >"$dir/artifact-metadata.json" <<JSON
{
  "platform": "android",
  "artifact_type": "apk",
  "build_profile": "android-internal",
  "app_version": "1.0.0",
  "commit_sha": "$VALID_SHA",
  "run_id": "1234567890",
  "run_url": "https://github.com/org/repo/actions/runs/1234567890",
  "triggered_by": "zctiong-iss"
}
JSON
  printf 'fake apk bytes' >"$dir/app-debug.apk"
}

# --- Happy path: valid metadata + a single binary artifact ---
happy="$WORK/happy"
make_valid_fixture "$happy"
expect 0 'exits 0 with valid metadata and a single artifact file' "$SCRIPT" "$happy"

output="$("$SCRIPT" "$happy")"
TESTS_RUN=$((TESTS_RUN + 1))
if [[ "$output" == *"commit_sha=$VALID_SHA"* ]]; then
  pass "extracts commit_sha from the source metadata file"
else
  fail "extracts commit_sha from the source metadata file"
fi

TESTS_RUN=$((TESTS_RUN + 1))
sha_line="$(echo "$output" | grep '^artifact_sha256=' || true)"
sha_value="${sha_line#artifact_sha256=}"
if [[ "$sha_value" =~ ^[0-9a-f]{64}$ ]]; then
  pass "outputs a 64-char lowercase-hex SHA-256"
else
  fail "outputs a 64-char lowercase-hex SHA-256 (got: $sha_value)"
fi

# --- The script never accepts a commit SHA as a separate argument (SEC-002) ---
TESTS_RUN=$((TESTS_RUN + 1))
if ! rg -q -- '\$2' "$SCRIPT" 2>/dev/null; then
  pass "script source never reads a second positional argument (no separate commit_sha input)"
else
  fail "script source never reads a second positional argument (no separate commit_sha input)"
fi

# --- Directory-bundle artifact (e.g. an iOS .app) also hashes deterministically ---
bundle="$WORK/bundle"
mkdir -p "$bundle"
cat >"$bundle/artifact-metadata.json" <<JSON
{"commit_sha": "$VALID_SHA"}
JSON
mkdir -p "$bundle/CrewSafe.app/nested"
printf 'binary' >"$bundle/CrewSafe.app/CrewSafe"
printf 'plist' >"$bundle/CrewSafe.app/nested/Info.plist"
expect 0 'exits 0 for a directory-bundle artifact' "$SCRIPT" "$bundle"
bundle_output="$("$SCRIPT" "$bundle")"
TESTS_RUN=$((TESTS_RUN + 1))
bundle_sha_line="$(echo "$bundle_output" | grep '^artifact_sha256=' || true)"
if [[ "${bundle_sha_line#artifact_sha256=}" =~ ^[0-9a-f]{64}$ ]]; then
  pass "hashes a directory-bundle artifact to a 64-char lowercase-hex SHA-256"
else
  fail "hashes a directory-bundle artifact to a 64-char lowercase-hex SHA-256"
fi

# --- Missing source metadata fails closed ---
missing_meta="$WORK/missing-meta"
mkdir -p "$missing_meta"
printf 'fake apk bytes' >"$missing_meta/app-debug.apk"
expect 1 'exits non-zero when artifact-metadata.json is missing' "$SCRIPT" "$missing_meta"

# --- Malformed (non-JSON) metadata fails closed ---
malformed="$WORK/malformed"
mkdir -p "$malformed"
printf 'not json at all' >"$malformed/artifact-metadata.json"
printf 'fake apk bytes' >"$malformed/app-debug.apk"
expect 1 'exits non-zero when artifact-metadata.json is not valid JSON' "$SCRIPT" "$malformed"

# --- Metadata with no commit_sha field fails closed ---
no_sha="$WORK/no-sha"
mkdir -p "$no_sha"
echo '{"platform": "android"}' >"$no_sha/artifact-metadata.json"
printf 'fake apk bytes' >"$no_sha/app-debug.apk"
expect 1 'exits non-zero when metadata has no commit_sha field' "$SCRIPT" "$no_sha"

# --- Metadata with a malformed commit_sha value fails closed ---
bad_sha="$WORK/bad-sha"
mkdir -p "$bad_sha"
echo '{"commit_sha": "not-a-real-sha"}' >"$bad_sha/artifact-metadata.json"
printf 'fake apk bytes' >"$bad_sha/app-debug.apk"
expect 1 'exits non-zero when commit_sha is not 40-char lowercase hex' "$SCRIPT" "$bad_sha"

# --- Nonexistent artifact directory fails closed ---
expect 1 'exits non-zero when the artifact directory does not exist' "$SCRIPT" "$WORK/does-not-exist"

printf '\n%d run, %d failed\n' "$TESTS_RUN" "$TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]
