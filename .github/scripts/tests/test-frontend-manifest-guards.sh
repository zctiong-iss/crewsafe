#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
TESTS_RUN=0
TESTS_FAILED=0

pass() {
  local label="$1"
  printf '  ok   %s\n' "$label"
}

fail() {
  local label="$1" detail="${2:-}"
  printf '  FAIL %s\n' "$label"
  [[ $# -gt 1 ]] && printf '       %s\n' "$detail"
  TESTS_FAILED=$((TESTS_FAILED + 1))
}

check() {
  local label="$1"
  shift
  TESTS_RUN=$((TESTS_RUN + 1))
  if "$@"; then
    pass "$label"
  else
    fail "$label"
  fi
}

manifest_script() {
  local manifest="$1" script="$2"
  node -e '
    const fs = require("node:fs");
    const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(String((manifest.scripts || {})[process.argv[2]] || ""));
  ' "$manifest" "$script"
}

assert_script_contains() {
  local manifest="$1" script="$2" needle="$3"
  [[ "$(manifest_script "$manifest" "$script")" == *"$needle"* ]]
}

assert_script_nonempty() {
  local manifest="$1" script="$2"
  [[ -n "$(manifest_script "$manifest" "$script")" ]]
}

assert_script_equals() {
  local manifest="$1" script="$2" expected="$3"
  [[ "$(manifest_script "$manifest" "$script")" == "$expected" ]]
}

assert_json_file() {
  local manifest="$1"
  node -e '
    const fs = require("node:fs");
    JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  ' "$manifest"
}

assert_no_publish_or_deploy_script() {
  local manifest="$1"
  node -e '
    const fs = require("node:fs");
    const scripts = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).scripts || {};
    process.exit(Object.keys(scripts).some((name) => /publish|deploy/i.test(name)) ? 1 : 0);
  ' "$manifest"
}

WEB="$ROOT/web/package.json"
MOBILE="$ROOT/mobile/package.json"

check "web package manifest parses" assert_json_file "$WEB"
check "web lockfile exists" test -f "$ROOT/web/package-lock.json"
check "web lint script exists" assert_script_nonempty "$WEB" lint
check "web typecheck is strict" assert_script_contains "$WEB" typecheck "tsc"
check "web typecheck is no-emit" assert_script_contains "$WEB" typecheck "--noEmit"
check "web unit-test script exists" assert_script_contains "$WEB" test "vitest"
check "web production build script exists" assert_script_contains "$WEB" build "vite build"
check "web ESLint config exists" test -f "$ROOT/web/eslint.config.js"

check "mobile package manifest parses" assert_json_file "$MOBILE"
check "mobile lockfile exists" test -f "$ROOT/mobile/package-lock.json"
check "mobile lint script exists" assert_script_nonempty "$MOBILE" lint
check "mobile typecheck script exists" assert_script_contains "$MOBILE" typecheck "tsc"
check "mobile build script exists" assert_script_contains "$MOBILE" build "expo export"
check "mobile build exports iOS" assert_script_contains "$MOBILE" build "expo export --platform ios"
check "mobile build exports Android" assert_script_contains "$MOBILE" build "expo export --platform android"
check "mobile ESLint config exists" test -f "$ROOT/mobile/eslint.config.js"

check "node_modules is ignored" rg -q '^node_modules/$' "$ROOT/.gitignore"
check "dist is ignored" rg -q '^dist/$' "$ROOT/.gitignore"
check "environment files are ignored" rg -q '^\.env\.\*$' "$ROOT/.gitignore"
check "web has no publish or deploy script" assert_no_publish_or_deploy_script "$WEB"
check "mobile has no publish or deploy script" assert_no_publish_or_deploy_script "$MOBILE"

printf '\n%d run, %d failed\n' "$TESTS_RUN" "$TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]
