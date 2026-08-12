#!/usr/bin/env bash
# Structural guard for SCRUM-242's Vite build-time configuration. Vite accepts
# missing VITE_* values at compile time; authConfig.ts then throws in the
# browser before React renders. Both web-ci.yml build paths must therefore
# mirror web-sync.yml's public configuration contract and validate it first.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/web-ci.yml"
TESTS_RUN=0
TESTS_FAILED=0
TMP_DIRS=()

cleanup() {
  local dir
  for dir in "${TMP_DIRS[@]}"; do
    [[ -e "$dir" ]] && rm -rf "$dir"
  done
}
trap cleanup EXIT INT TERM

pass() { printf '  ok   %s\n' "$1"; }

fail() {
  printf '  FAIL %s\n' "$1"
  [[ $# -gt 1 ]] && printf '       %s\n' "$2"
  TESTS_FAILED=$((TESTS_FAILED + 1))
}

job_block() {
  local path="$1" job="$2"
  awk -v job="$job" '
    $0 == "  " job ":" { in_job = 1 }
    in_job && $0 ~ /^  [A-Za-z0-9_-]+:$/ && $0 != "  " job ":" { exit }
    in_job { print }
  ' "$path"
}

contains() {
  local label="$1" text="$2" needle="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ "$text" == *"$needle"* ]]; then
    pass "$label"
  else
    fail "$label" "missing text: $needle"
  fi
}

assert_order() {
  local label="$1" text="$2" first="$3" second="$4"
  local first_line second_line
  first_line="$(printf '%s\n' "$text" | rg -n -m 1 -F -- "$first" | cut -d: -f1 || true)"
  second_line="$(printf '%s\n' "$text" | rg -n -m 1 -F -- "$second" | cut -d: -f1 || true)"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ -n "$first_line" && -n "$second_line" && "$first_line" -lt "$second_line" ]]; then
    pass "$label"
  else
    fail "$label" "expected $first before $second"
  fi
}

web_build_config_guard() {
  local path="$1" job block
  local expected=(
    'VITE_COGNITO_AUTHORITY: ${{ fromJSON(vars.CREWSAFE_SHARED_COGNITO_JSON).accounts.dev.issuer_uri }}'
    'VITE_COGNITO_CLIENT_ID: ${{ fromJSON(vars.CREWSAFE_SHARED_COGNITO_JSON).accounts.dev.web_client_id }}'
    'VITE_COGNITO_HOSTED_UI_DOMAIN: ${{ fromJSON(vars.CREWSAFE_SHARED_COGNITO_JSON).accounts.dev.hosted_ui_url }}'
    'VITE_REDIRECT_URI: ${{ vars.CREWSAFE_WEB_BASE_URL }}/callback'
    'VITE_POST_LOGOUT_REDIRECT_URI: ${{ vars.CREWSAFE_WEB_BASE_URL }}/'
    'VITE_API_BASE_URL: ${{ vars.CREWSAFE_BACKEND_BASE_URL }}'
  )

  [[ -f "$path" ]] || return 1
  for job in build-test deploy-staging; do
    block="$(job_block "$path" "$job")"
    [[ -n "$block" ]] || return 1
    for mapping in "${expected[@]}"; do
      [[ "$block" == *"$mapping"* ]] || return 1
    done
    [[ "$block" == *'name: Validate web build configuration'* ]] || return 1
    [[ "$block" == *'[[ "$WEB_BASE_URL" =~ ^https://[a-z0-9]+\.cloudfront\.net$ ]]'* ]] || return 1
    [[ "$block" == *'[[ -n "$VITE_COGNITO_AUTHORITY" ]]'* ]] || return 1
    [[ "$block" == *'[[ -n "$VITE_COGNITO_CLIENT_ID" ]]'* ]] || return 1
    [[ "$block" == *'[[ -n "$VITE_COGNITO_HOSTED_UI_DOMAIN" ]]'* ]] || return 1
    [[ "$block" == *'[[ "$VITE_REDIRECT_URI" == "$WEB_BASE_URL/callback" ]]'* ]] || return 1
    [[ "$block" == *'[[ "$VITE_POST_LOGOUT_REDIRECT_URI" == "$WEB_BASE_URL/" ]]'* ]] || return 1
    [[ "$block" == *'[[ "$VITE_API_BASE_URL" =~ ^https://[a-z0-9]+\.cloudfront\.net$ ]]'* ]] || return 1
    if [[ "$job" == build-test ]]; then
      assert_order_guard "$block" 'name: Validate web build configuration' 'run: npm run build' || return 1
    else
      assert_order_guard "$block" 'name: Validate web build configuration' 'npm ci && npm run build' || return 1
      assert_order_guard "$block" 'name: Validate web build configuration' 'run: ./scripts/sync-static-site.sh' || return 1
    fi
  done
}

assert_order_guard() {
  local text="$1" first="$2" second="$3" first_line second_line
  first_line="$(printf '%s\n' "$text" | rg -n -m 1 -F -- "$first" | cut -d: -f1 || true)"
  second_line="$(printf '%s\n' "$text" | rg -n -m 1 -F -- "$second" | cut -d: -f1 || true)"
  [[ -n "$first_line" && -n "$second_line" && "$first_line" -lt "$second_line" ]]
}

mutate_fixture() {
  local path="$1" mutation="$2"
  case "$mutation" in
    missing-api-base-url)
      sed '/VITE_API_BASE_URL: \${{ vars.CREWSAFE_BACKEND_BASE_URL }}/d' "$path" >"$path.next"
      mv "$path.next" "$path"
      ;;
    wrong-cognito-source)
      sed 's/\.accounts\.dev\.issuer_uri/.accounts.dev.wrong_issuer/g' "$path" >"$path.next"
      mv "$path.next" "$path"
      ;;
    validation-after-build)
      awk '
        /name: Validate web build configuration/ {
          matches += 1
        }
        matches == 2 && !replaced {
          sub(/name: Validate web build configuration/, "name: Deferred validation")
          replaced = 1
        }
        { print }
      ' "$path" >"$path.next"
      mv "$path.next" "$path"
      printf '\n      - name: Validate web build configuration\n' >>"$path"
      ;;
    *)
      printf 'unknown fixture mutation: %s\n' "$mutation" >&2
      return 1
      ;;
  esac
}

assert_rejected_fixture() {
  local label="$1" mutation="$2" fixture
  fixture="$(mktemp -d)/web-ci.yml"
  TMP_DIRS+=("${fixture%/web-ci.yml}")
  cp "$WORKFLOW" "$fixture"
  mutate_fixture "$fixture" "$mutation"
  TESTS_RUN=$((TESTS_RUN + 1))
  if ! web_build_config_guard "$fixture"; then
    pass "$label"
  else
    fail "$label" "workflow guard accepted mutation: $mutation"
  fi
}

[[ -f "$WORKFLOW" ]] || { printf 'missing workflow: %s\n' "$WORKFLOW" >&2; exit 1; }

for job in build-test deploy-staging; do
  block="$(job_block "$WORKFLOW" "$job")"
  contains "$job exists" "$block" "  $job:"
  contains "$job has Cognito authority mapping" "$block" 'VITE_COGNITO_AUTHORITY: ${{ fromJSON(vars.CREWSAFE_SHARED_COGNITO_JSON).accounts.dev.issuer_uri }}'
  contains "$job has Cognito client mapping" "$block" 'VITE_COGNITO_CLIENT_ID: ${{ fromJSON(vars.CREWSAFE_SHARED_COGNITO_JSON).accounts.dev.web_client_id }}'
  contains "$job has Cognito hosted UI mapping" "$block" 'VITE_COGNITO_HOSTED_UI_DOMAIN: ${{ fromJSON(vars.CREWSAFE_SHARED_COGNITO_JSON).accounts.dev.hosted_ui_url }}'
  contains "$job has callback URL mapping" "$block" 'VITE_REDIRECT_URI: ${{ vars.CREWSAFE_WEB_BASE_URL }}/callback'
  contains "$job has logout URL mapping" "$block" 'VITE_POST_LOGOUT_REDIRECT_URI: ${{ vars.CREWSAFE_WEB_BASE_URL }}/'
  contains "$job has API base URL mapping" "$block" 'VITE_API_BASE_URL: ${{ vars.CREWSAFE_BACKEND_BASE_URL }}'
  contains "$job validates configuration" "$block" 'name: Validate web build configuration'
done

build_test_block="$(job_block "$WORKFLOW" build-test)"
deploy_block="$(job_block "$WORKFLOW" deploy-staging)"
assert_order "build-test validates before production build" "$build_test_block" 'name: Validate web build configuration' 'run: npm run build'
assert_order "deploy validates before production build" "$deploy_block" 'name: Validate web build configuration' 'npm ci && npm run build'
assert_order "deploy validates before S3 sync" "$deploy_block" 'name: Validate web build configuration' 'run: ./scripts/sync-static-site.sh'

TESTS_RUN=$((TESTS_RUN + 1))
if web_build_config_guard "$WORKFLOW"; then
  pass "base workflow passes build configuration guard"
else
  fail "base workflow passes build configuration guard"
fi

assert_rejected_fixture "negative missing API URL fixture is rejected" missing-api-base-url
assert_rejected_fixture "negative wrong Cognito mapping fixture is rejected" wrong-cognito-source
assert_rejected_fixture "negative late validation fixture is rejected" validation-after-build

printf '\n%d run, %d failed\n' "$TESTS_RUN" "$TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]
