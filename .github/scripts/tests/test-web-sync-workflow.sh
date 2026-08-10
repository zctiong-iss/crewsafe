#!/usr/bin/env bash
# Structural guard for web-sync.yml (SCRUM-298 FR-017), mirroring
# test-web-image-workflow.sh's pattern for web-ci.yml. The single most
# important property this checks: the workflow declares workflow_dispatch
# ONLY — no push, no pull_request. Unlike build-test, this workflow writes to
# a production-facing bucket and invalidates a live distribution; it must
# never run automatically.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/web-sync.yml"
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

pass() {
  printf '  ok   %s\n' "$1"
}

fail() {
  printf '  FAIL %s\n' "$1"
  [[ $# -gt 1 ]] && printf '       %s\n' "$2"
  TESTS_FAILED=$((TESTS_FAILED + 1))
}

contains_in() {
  local label="$1" path="$2" needle="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ -f "$path" ]] && rg -q -F -- "$needle" "$path"; then
    pass "$label"
  else
    fail "$label" "missing text in $path: $needle"
  fi
}

not_contains_in() {
  local label="$1" path="$2" needle="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ ! -f "$path" ]] || ! rg -q -F -- "$needle" "$path"; then
    pass "$label"
  else
    fail "$label" "forbidden text found in $path: $needle"
  fi
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

assert_order() {
  local label="$1" path="$2"
  shift 2
  local previous=0 current needle
  for needle in "$@"; do
    current="$(rg -n -m 1 -F -- "$needle" "$path" | cut -d: -f1 || true)"
    if [[ -z "$current" || "$current" -le "$previous" ]]; then
      TESTS_RUN=$((TESTS_RUN + 1))
      fail "$label" "expected ordered text: $needle"
      return
    fi
    previous="$current"
  done
  TESTS_RUN=$((TESTS_RUN + 1))
  pass "$label"
}

# The FR-017 boundary, expressed as a guard: workflow_dispatch is the only
# trigger. A `push:` or `pull_request:` key anywhere in the trigger block
# would make this workflow run automatically against untrusted or routine
# commits, defeating the manually-dispatched, OIDC-only design.
workflow_policy_guard() {
  local path="$1"
  [[ -f "$path" ]] || return 1
  rg -q -F -- 'workflow_dispatch:' "$path" || return 1
  rg -q -F -- 'commit_sha' "$path" || return 1
  rg -q -F -- 'required: true' "$path" || return 1
  rg -q -F -- 'contents: read' "$path" || return 1
  rg -q -F -- 'id-token: write' "$path" || return 1
  rg -q -F -- 'CREWSAFE_WEB_SYNC_ROLE_ARN' "$path" || return 1
  rg -q -F -- 'CREWSAFE_WEB_BUCKET_NAME' "$path" || return 1
  rg -q -F -- 'CREWSAFE_WEB_DISTRIBUTION_ID' "$path" || return 1
  rg -q -F -- '^[0-9a-f]{40}$' "$path" || return 1
  rg -q -F -- 'role/crewsafe-shared-dev-web-sync' "$path" || return 1
  rg -q -F -- 'aws s3 sync' "$path" || return 1
  rg -q -F -- '--delete' "$path" || return 1
  rg -q -F -- 'create-invalidation' "$path" || return 1
  rg -q -F -- 'GITHUB_STEP_SUMMARY' "$path" || return 1

  if rg '^\s*on:' -A 5 "$path" | rg -q '^\s*(push|pull_request):'; then
    return 1
  fi
  if rg -n 'uses: .+@' "$path" | rg -v '@[0-9a-f]{40}$' >/dev/null; then
    return 1
  fi
  if rg -n -e 'AWS_ACCESS_KEY_ID' -e 'AWS_SECRET_ACCESS_KEY' -e 'AWS_SESSION_TOKEN' \
    -e 'continue-on-error:' -e 'contents: write' -e 'cloudfront:GetInvalidation' \
    -e "'push'" -e "'pull_request'" "$path" >/dev/null; then
    return 1
  fi
  return 0
}

replace_fixture_text() {
  local path="$1" pattern="$2" replacement="$3"
  sed "s|$pattern|$replacement|g" "$path" >"$path.next"
  mv "$path.next" "$path"
}

mutate_fixture() {
  local path="$1" mutation="$2"
  case "$mutation" in
  add-push-trigger)
    # Insert a push: trigger immediately after the "on:" line, inside the
    # trigger block the guard's -A 5 window actually inspects — appending at
    # file end would land outside that window and prove nothing.
    sed '/^on:$/a\
  push:\
    branches: [main]
' "$path" >"$path.next"
    mv "$path.next" "$path"
    ;;
  missing-oidc)
    replace_fixture_text "$path" 'id-token: write' 'id-token: read'
    ;;
  no-delete-flag)
    replace_fixture_text "$path" ' --delete' ''
    ;;
  static-credentials)
    printf '\nAWS_ACCESS_KEY_ID: hardcoded\n' >>"$path"
    ;;
  continue-on-error)
    printf '\ncontinue-on-error: true\n' >>"$path"
    ;;
  mutable-action)
    printf '\n      - uses: actions/checkout@main\n' >>"$path"
    ;;
  widened-permission)
    printf '\ncontents: write\n' >>"$path"
    ;;
  polls-invalidation)
    printf '\ncloudfront:GetInvalidation\n' >>"$path"
    ;;
  *)
    printf 'unknown fixture mutation: %s\n' "$mutation" >&2
    return 1
    ;;
  esac
}

assert_rejected_fixture() {
  local label="$1" mutation="$2"
  local fixture
  fixture="$(mktemp)"
  TMP_DIRS+=("$fixture")
  cp "$WORKFLOW" "$fixture"
  mutate_fixture "$fixture" "$mutation"
  TESTS_RUN=$((TESTS_RUN + 1))
  if ! workflow_policy_guard "$fixture"; then
    pass "$label"
  else
    fail "$label" "workflow policy guard accepted mutation: $mutation"
  fi
}

check_file "web sync workflow exists" "$WORKFLOW"
TESTS_RUN=$((TESTS_RUN + 1))
if workflow_policy_guard "$WORKFLOW"; then
  pass "base workflow passes policy guard"
else
  fail "base workflow passes policy guard"
fi

contains_in "workflow_dispatch trigger exists" "$WORKFLOW" 'workflow_dispatch:'
not_contains_in "no push trigger" "$WORKFLOW" '  push:'
not_contains_in "no pull_request trigger" "$WORKFLOW" '  pull_request:'
contains_in "commit_sha input is required" "$WORKFLOW" 'required: true'
contains_in "commit_sha input is a string" "$WORKFLOW" 'type: string'
contains_in "has read permission" "$WORKFLOW" 'contents: read'
contains_in "has OIDC permission" "$WORKFLOW" 'id-token: write'
contains_in "AWS credentials action is pinned" "$WORKFLOW" 'aws-actions/configure-aws-credentials@e6de'
contains_in "checkout action is pinned" "$WORKFLOW" 'actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd'
contains_in "reuses build-test's own npm steps" "$WORKFLOW" 'npm run build'
contains_in "runs lint" "$WORKFLOW" 'npm run lint'
contains_in "runs typecheck" "$WORKFLOW" 'npm run typecheck'
contains_in "runs unit tests" "$WORKFLOW" 'npm test'
contains_in "syncs to S3" "$WORKFLOW" 'aws s3 sync'
contains_in "sync prunes stale objects" "$WORKFLOW" '--delete'
contains_in "invalidates the distribution" "$WORKFLOW" 'create-invalidation'
contains_in "invalidation targets the whole distribution" "$WORKFLOW" "'/*'"
contains_in "writes a step summary" "$WORKFLOW" 'GITHUB_STEP_SUMMARY'
contains_in "records the invalidation id" "$WORKFLOW" 'invalidation_id'
contains_in "validates the commit SHA format" "$WORKFLOW" '^[0-9a-f]{40}$'
contains_in "validates the exact sync role" "$WORKFLOW" 'role/crewsafe-shared-dev-web-sync'
not_contains_in "no static AWS access key" "$WORKFLOW" 'AWS_ACCESS_KEY_ID:'
not_contains_in "no static AWS secret key" "$WORKFLOW" 'AWS_SECRET_ACCESS_KEY:'
not_contains_in "no continue-on-error" "$WORKFLOW" 'continue-on-error:'
not_contains_in "does not poll for invalidation completion" "$WORKFLOW" 'cloudfront:GetInvalidation'
not_contains_in "does not wait for invalidation" "$WORKFLOW" 'wait invalidation-completed'

assert_order "build precedes credential assumption" "$WORKFLOW" \
  'npm run build' 'configure-aws-credentials'
assert_order "credentials precede sync, sync precedes invalidation" "$WORKFLOW" \
  'configure-aws-credentials' 'aws s3 sync' 'create-invalidation'

assert_rejected_fixture "negative push-trigger fixture is rejected" add-push-trigger
assert_rejected_fixture "negative missing-OIDC fixture is rejected" missing-oidc
assert_rejected_fixture "negative no-delete-flag fixture is rejected" no-delete-flag
assert_rejected_fixture "negative static-credentials fixture is rejected" static-credentials
assert_rejected_fixture "negative continue-on-error fixture is rejected" continue-on-error
assert_rejected_fixture "negative mutable-action fixture is rejected" mutable-action
assert_rejected_fixture "negative widened-permission fixture is rejected" widened-permission
assert_rejected_fixture "negative polls-invalidation fixture is rejected" polls-invalidation

printf '\n%d run, %d failed\n' "$TESTS_RUN" "$TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]
