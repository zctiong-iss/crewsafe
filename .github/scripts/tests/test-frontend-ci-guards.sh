#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
WEB_WORKFLOW="$ROOT/.github/workflows/web-ci.yml"
MOBILE_WORKFLOW="$ROOT/.github/workflows/mobile-ci.yml"
TESTS_RUN=0
TESTS_FAILED=0

pass() {
  printf '  ok   %s\n' "$1"
}

fail() {
  printf '  FAIL %s\n' "$1"
  [[ $# -gt 1 ]] && printf '       %s\n' "$2"
  TESTS_FAILED=$((TESTS_FAILED + 1))
}

check_file() {
  local label="$1" path="$2"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ -f "$path" ]]; then
    pass "$label"
  else
    fail "$label" "missing file: $path"
  fi
}

contains_in() {
  local label="$1" path="$2" needle="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ -f "$path" ]] && rg -q -F -- "$needle" "$path"; then
    pass "$label"
  else
    fail "$label" "missing workflow text in $path: $needle"
  fi
}

not_contains_in() {
  local label="$1" path="$2" needle="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ ! -f "$path" ]] || ! rg -q -F -- "$needle" "$path"; then
    pass "$label"
  else
    fail "$label" "forbidden workflow text found in $path: $needle"
  fi
}

line_after_anchor() {
  local path="$1" anchor="$2" needle="$3"
  awk -v anchor="$anchor" -v needle="$needle" '
    index($0, anchor) { started = 1 }
    started && index($0, needle) { print NR; exit }
  ' "$path"
}

assert_order_after() {
  local path="$1" label="$2" anchor="$3"
  shift 3
  local previous=0 current needle
  for needle in "$@"; do
    current="$(line_after_anchor "$path" "$anchor" "$needle")"
    if [[ -z "$current" || "$current" -le "$previous" ]]; then
      TESTS_RUN=$((TESTS_RUN + 1))
      fail "$label" "expected ordered step after $anchor: $needle"
      return
    fi
    previous="$current"
  done
  TESTS_RUN=$((TESTS_RUN + 1))
  pass "$label"
}

check_file "web workflow exists" "$WEB_WORKFLOW"
check_file "mobile workflow exists" "$MOBILE_WORKFLOW"
not_contains_in "combined workflow is removed" "$ROOT/.github/workflows/frontend-ci.yml" 'name: Frontend CI'

for workflow in "$WEB_WORKFLOW" "$MOBILE_WORKFLOW"; do
  contains_in "pull request trigger exists in $(basename "$workflow")" "$workflow" 'pull_request:'
  contains_in "push trigger exists in $(basename "$workflow")" "$workflow" 'push:'
  contains_in "manual workflow dispatch exists in $(basename "$workflow")" "$workflow" 'workflow_dispatch:'
  contains_in "main branch trigger in $(basename "$workflow")" "$workflow" 'branches: [main]'
  contains_in "shared test path filter in $(basename "$workflow")" "$workflow" '.github/scripts/tests/**'
  contains_in "read-only contents permission in $(basename "$workflow")" "$workflow" 'contents: read'
  contains_in "concurrency cancellation in $(basename "$workflow")" "$workflow" 'cancel-in-progress: true'
  contains_in "immutable checkout action in $(basename "$workflow")" "$workflow" 'actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd'
  contains_in "immutable setup-node action in $(basename "$workflow")" "$workflow" 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020'
  contains_in "exact pull request revision checkout in $(basename "$workflow")" "$workflow" 'github.event.pull_request.head.sha || github.sha'
  not_contains_in "no continue-on-error in $(basename "$workflow")" "$workflow" 'continue-on-error:'
  not_contains_in "no deployment command in $(basename "$workflow")" "$workflow" 'deploy'
  not_contains_in "no catch-all path trigger in $(basename "$workflow")" "$workflow" 'paths: ["**"]'
done

not_contains_in "mobile workflow never publishes" "$MOBILE_WORKFLOW" 'publish'
not_contains_in "mobile workflow has no cloud credential action" "$MOBILE_WORKFLOW" 'configure-aws-credentials'
not_contains_in "mobile workflow has no artifact upload" "$MOBILE_WORKFLOW" 'upload-artifact'
not_contains_in "mobile workflow has no write permission" "$MOBILE_WORKFLOW" 'contents: write'
not_contains_in "mobile workflow has no job-level condition" "$MOBILE_WORKFLOW" 'if:'

contains_in "web path filter exists" "$WEB_WORKFLOW" 'web/**'
contains_in "web workflow self-filter exists" "$WEB_WORKFLOW" '.github/workflows/web-ci.yml'
not_contains_in "web workflow excludes mobile source" "$WEB_WORKFLOW" 'mobile/**'
not_contains_in "web workflow excludes mobile workflow" "$WEB_WORKFLOW" '.github/workflows/mobile-ci.yml'
contains_in "mobile path filter exists" "$MOBILE_WORKFLOW" 'mobile/**'
contains_in "mobile workflow self-filter exists" "$MOBILE_WORKFLOW" '.github/workflows/mobile-ci.yml'
not_contains_in "mobile workflow excludes web source" "$MOBILE_WORKFLOW" 'web/**'
not_contains_in "mobile workflow excludes web workflow" "$MOBILE_WORKFLOW" '.github/workflows/web-ci.yml'

contains_in "web workflow is independently named" "$WEB_WORKFLOW" 'name: Web CI'
contains_in "web validation job uses backend shape" "$WEB_WORKFLOW" 'build-test:'
contains_in "web validation job is named Build and Test" "$WEB_WORKFLOW" 'name: Build and Test'
contains_in "web job uses web directory" "$WEB_WORKFLOW" 'working-directory: web'
contains_in "web npm ci command" "$WEB_WORKFLOW" 'npm ci'
contains_in "web lint command" "$WEB_WORKFLOW" 'npm run lint'
contains_in "web typecheck command" "$WEB_WORKFLOW" 'npm run typecheck'
contains_in "web test command" "$WEB_WORKFLOW" 'npm test'
contains_in "web build command" "$WEB_WORKFLOW" 'npm run build'
assert_order_after "$WEB_WORKFLOW" "web validation command order" "name: Build and Test" \
  'npm ci' 'npm run lint' 'npm run typecheck' 'npm test' 'npm run build'

contains_in "mobile job is independently named" "$MOBILE_WORKFLOW" 'name: Mobile CI'
contains_in "mobile job uses mobile directory" "$MOBILE_WORKFLOW" 'working-directory: mobile'
contains_in "mobile npm ci command" "$MOBILE_WORKFLOW" 'npm ci'
contains_in "mobile lint command" "$MOBILE_WORKFLOW" 'npm run lint'
contains_in "mobile typecheck command" "$MOBILE_WORKFLOW" 'npm run typecheck'
contains_in "mobile build command" "$MOBILE_WORKFLOW" 'npm run build'
assert_order_after "$MOBILE_WORKFLOW" "mobile validation command order" "name: Mobile CI" \
  'npm ci' 'npm run lint' 'npm run typecheck' 'npm run build'

printf '\n%d run, %d failed\n' "$TESTS_RUN" "$TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]
