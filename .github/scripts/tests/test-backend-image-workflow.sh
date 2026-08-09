#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/backend-ci.yml"
TESTS_RUN=0
TESTS_FAILED=0
TMP_DIRS=()

cleanup() {
  local dir
  for dir in "${TMP_DIRS[@]:-}"; do
    [[ -n "$dir" && -e "$dir" ]] && rm -rf "$dir"
  done
}
trap cleanup EXIT INT TERM

pass() { printf '  ok   %s\n' "$1"; }
fail() {
  printf '  FAIL %s\n' "$1"
  [[ $# -gt 1 ]] && printf '       %s\n' "$2"
  TESTS_FAILED=$((TESTS_FAILED + 1))
}

check_file() {
  local label="$1" path="$2"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ -f "$path" ]]; then pass "$label"; else fail "$label" "missing file: $path"; fi
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

not_contains_in_build_test() {
  local label="$1" needle="$2" block
  block="$(awk '
    /^  build-test:/ { started = 1 }
    started && /^  publish-image:/ { exit }
    started { print }
  ' "$WORKFLOW")"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ "$block" != *"$needle"* ]]; then
    pass "$label"
  else
    fail "$label" "forbidden build-test text found: $needle"
  fi
}

# workflow_policy_guard <path> -- structural + security assertions on the
# publish-image job, matching test-web-image-workflow.sh's shape.
workflow_policy_guard() {
  local path="$1"
  [[ -f "$path" ]] || return 1
  rg -q -F -- 'needs: build-test' "$path" || return 1
  rg -q -F -- "github.ref == 'refs/heads/main'" "$path" || return 1
  rg -q -F -- "github.event_name == 'push'" "$path" || return 1
  rg -q -F -- 'inputs.publish' "$path" || return 1
  rg -q -F -- 'contents: read' "$path" || return 1
  rg -q -F -- 'id-token: write' "$path" || return 1
  rg -q -F -- 'docker build' "$path" || return 1
  rg -q -F -- 'aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25' "$path" || return 1
  rg -q -F -- 'severity: HIGH,CRITICAL' "$path" || return 1
  rg -q -F -- "exit-code: '0'" "$path" || return 1
  rg -q -F -- 'docker push' "$path" || return 1

  if rg -n 'uses: .+@' "$path" | rg -v '@[0-9a-f]{40}$' >/dev/null; then
    return 1
  fi
  if rg -n -e 'AWS_ACCESS_KEY_ID' -e 'AWS_SECRET_ACCESS_KEY' -e 'continue-on-error:' "$path" >/dev/null; then
    return 1
  fi
  # The scan step must precede AWS-credentialed steps -- a blocking/failed
  # scan must never reach a credentialed step (SEC-001).
  local scan_line creds_line
  scan_line="$(rg -n -m 1 -F -- 'aquasecurity/trivy-action' "$path" | cut -d: -f1)"
  creds_line="$(rg -n -m 1 -F -- 'configure-aws-credentials' "$path" | cut -d: -f1)"
  [[ -n "$scan_line" && -n "$creds_line" && "$scan_line" -lt "$creds_line" ]] || return 1
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
    remove-scan-step)
      sed '/aquasecurity\/trivy-action/,+4d' "$path" >"$path.next"
      mv "$path.next" "$path"
      ;;
    continue-on-error)
      printf '\ncontinue-on-error: true\n' >>"$path"
      ;;
    static-aws-key)
      printf '\nAWS_ACCESS_KEY_ID: hardcoded\n' >>"$path"
      ;;
    mutable-action)
      printf '\n      - uses: actions/checkout@main\n' >>"$path"
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

printf 'test-backend-image-workflow\n'
check_file "backend workflow exists" "$WORKFLOW"
check_file "backend Dockerfile exists" "$ROOT/backend/Dockerfile"

# --- SCRUM-269 US1 (T013): trigger predicates survive the restructuring --
# unchanged (analysis finding F2), mirroring test-web-image-workflow.sh's
# own checks for the equivalent web job.
contains_in "publication job exists" "$WORKFLOW" 'publish-image:'
contains_in "publication waits for validation" "$WORKFLOW" 'needs: build-test'
contains_in "publication is main-only" "$WORKFLOW" "github.ref == 'refs/heads/main'"
contains_in "push publication predicate exists" "$WORKFLOW" "github.event_name == 'push'"
contains_in "manual publication predicate exists" "$WORKFLOW" 'inputs.publish'
contains_in "publication has read permission" "$WORKFLOW" 'contents: read'
contains_in "publication has OIDC permission" "$WORKFLOW" 'id-token: write'

# --- US1 AS1/AS2 (T013): report-only scan step present, correctly configured
contains_in "publication builds backend image" "$WORKFLOW" 'docker build'
contains_in "publication scans image" "$WORKFLOW" 'aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25'
contains_in "scan uses HIGH,CRITICAL severity" "$WORKFLOW" 'severity: HIGH,CRITICAL'
contains_in "scan does not ignore unfixed findings" "$WORKFLOW" 'ignore-unfixed: false'
contains_in "scan is report-only (FR-001)" "$WORKFLOW" "exit-code: '0'"
not_contains_in "scan is not blocking yet (FR-001a is a separate follow-up)" "$WORKFLOW" "exit-code: '1'"
contains_in "publication pushes image" "$WORKFLOW" 'docker push'
not_contains_in "workflow has no static AWS access key" "$WORKFLOW" 'AWS_ACCESS_KEY_ID'
not_contains_in "workflow has no static AWS secret key" "$WORKFLOW" 'AWS_SECRET_ACCESS_KEY'
not_contains_in "workflow has no continue-on-error" "$WORKFLOW" 'continue-on-error:'
not_contains_in_build_test "validation job has no OIDC permission" 'id-token: write'
not_contains_in_build_test "validation job has no AWS credential action" 'configure-aws-credentials'
not_contains_in_build_test "validation job has no image push" 'docker push'

assert_order "build -> scan -> AWS credentials -> login -> push" "$WORKFLOW" \
  'docker build' 'aquasecurity/trivy-action' 'configure-aws-credentials' 'aws ecr get-login-password' 'docker push'

# --- SCRUM-269 US3 (T034): ignorefile prep precedes the scan step ---------
contains_in "ignorefile prep step references the source exceptions file" "$WORKFLOW" \
  'backend-image.trivyignore.source'
contains_in "ignorefile prep step invokes filter-trivyignore.sh" "$WORKFLOW" \
  'filter-trivyignore.sh'
assert_order "ignorefile prep precedes the scan step" "$WORKFLOW" \
  'filter-trivyignore.sh' 'aquasecurity/trivy-action'
contains_in "scan step passes the active ignorefile via trivyignores" "$WORKFLOW" \
  'trivyignores: .trivyignore-active-backend'

TESTS_RUN=$((TESTS_RUN + 1))
if workflow_policy_guard "$WORKFLOW"; then
  pass "base workflow passes policy guard"
else
  fail "base workflow passes policy guard"
fi

# --- US1 AS3 (T014): negative/mutation tests -------------------------------
assert_rejected_fixture "negative missing scan step fixture is rejected" remove-scan-step
assert_rejected_fixture "negative continue-on-error fixture is rejected" continue-on-error
assert_rejected_fixture "negative static AWS key fixture is rejected" static-aws-key
assert_rejected_fixture "negative mutable action fixture is rejected" mutable-action

printf '\n%d run, %d failed\n' "$TESTS_RUN" "$TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]
