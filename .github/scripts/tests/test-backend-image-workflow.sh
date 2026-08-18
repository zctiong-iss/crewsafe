#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/backend-ci.yml"
TESTS_RUN=0
TESTS_FAILED=0
TMP_DIRS=()
readonly DOCKER_BUILD_CMD='docker build'
readonly DOCKER_PUSH_CMD='docker push'
readonly TRIVY_ACTION='aquasecurity/trivy-action'

cleanup() {
  local dir
  for dir in "${TMP_DIRS[@]:-}"; do
    [[ -n "$dir" && -e "$dir" ]] && rm -rf "$dir"
  done
}
trap cleanup EXIT INT TERM

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
  rg -q -F -- "$DOCKER_BUILD_CMD" "$path" || return 1
  rg -q -F -- 'aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25' "$path" || return 1
  rg -q -F -- 'severity: HIGH,CRITICAL' "$path" || return 1
  rg -q -F -- "exit-code: '1'" "$path" || return 1
  ! rg -q -F -- "exit-code: '0'" "$path" || return 1
  rg -q -F -- '.github/scripts/security/validate-trivy-exceptions.sh' "$path" || return 1
  rg -q -F -- 'if: always()' "$path" || return 1
  rg -q -F -- 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a' "$path" || return 1
  rg -q -F -- 'retention-days: 7' "$path" || return 1
  rg -q -F -- "$DOCKER_PUSH_CMD" "$path" || return 1
  # SCRUM-270 US1: the pushed image's digest MUST be captured, validated,
  # and surfaced as job outputs -- FR-001/FR-002.
  rg -q -F -- 'RepoDigests' "$path" || return 1
  rg -q -F -- 'GITHUB_OUTPUT' "$path" || return 1
  rg -q -F -- "run_id=\$GITHUB_RUN_ID" "$path" || return 1
  # SCRUM-270 US2: the job MUST validate its repository/role/tag contract
  # before building -- FR-004.
  rg -q -F -- 'crewsafe/backend' "$path" || return 1
  rg -q -F -- 'crewsafe-shared-dev-ecr-push' "$path" || return 1
  rg -q -F -- '^[0-9a-f]{40}$' "$path" || return 1

  if rg -n 'uses: .+@' "$path" | rg -v '@[0-9a-f]{40}$' >/dev/null; then
    return 1
  fi
  if rg -n -e 'AWS_ACCESS_KEY_ID' -e 'AWS_SECRET_ACCESS_KEY' -e 'continue-on-error:' "$path" >/dev/null; then
    return 1
  fi
  # The scan step must precede AWS-credentialed steps -- a blocking/failed
  # scan must never reach a credentialed step (SEC-001).
  local scan_line creds_line validate_line
  scan_line="$(rg -n -m 1 -F -- "$TRIVY_ACTION" "$path" | cut -d: -f1)"
  creds_line="$(rg -n -m 1 -F -- 'configure-aws-credentials' "$path" | cut -d: -f1)"
  [[ -n "$scan_line" && -n "$creds_line" && "$scan_line" -lt "$creds_line" ]] || return 1
  # SCRUM-270 (SEC-001): the contract-validation step must also precede any
  # AWS-credentialed step -- a bad repository/role/tag must never reach a
  # credentialed step either.
  validate_line="$(rg -n -m 1 -F -- 'Validate backend publication contract' "$path" | cut -d: -f1)"
  [[ -n "$validate_line" && -n "$creds_line" && "$validate_line" -lt "$creds_line" ]] || return 1
  return 0
}

# SCRUM-242: an applied task-start parameter needs a fresh task, but its
# approved backend release may predate the current workflow change. The replay
# branch must therefore deploy only an approved ancestor's existing image.
redeploy_policy_guard() {
  local path="$1" block
  [[ -f "$path" ]] || return 1
  rg -q -F -- 'redeploy:' "$path" || return 1
  rg -q -F -- 'redeploy_image_tag:' "$path" || return 1
  rg -q -F -- 'inputs.redeploy && !inputs.publish' "$path" || return 1
  rg -q -F -- 'inputs.publish && !inputs.redeploy' "$path" || return 1
  rg -q -F -- 'resolve-existing-image:' "$path" || return 1
  rg -q -F -- 'github.event_name == '"'"'workflow_dispatch'"'"'' "$path" || return 1
  rg -q -F -- 'inputs.redeploy_image_tag' "$path" || return 1
  rg -q -F -- 'fetch-depth: 0' "$path" || return 1
  rg -q -F -- 'git merge-base --is-ancestor "$IMAGE_TAG" "$GITHUB_SHA"' "$path" || return 1
  rg -q -F -- 'aws ecr describe-images' "$path" || return 1
  rg -q -F -- 'imageTag="$IMAGE_TAG"' "$path" || return 1
  rg -q -F -- 'aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25' "$path" || return 1
  rg -q -F -- 'image-ref: "${{ env.REPO }}@${{ steps.resolve.outputs.image_digest }}"' "$path" || return 1
  rg -q -F -- 'trivy-backend-redeploy-report.json' "$path" || return 1
  rg -q -F -- 'Scan existing backend image' "$path" || return 1
  rg -q -F -- 'Upload existing backend Trivy report' "$path" || return 1
  rg -q -F -- 'crewsafe-shared-dev-backend-deploy' "$path" || return 1
  rg -q -F -- 'deploy-backend-staging.sh' "$path" || return 1
  ! rg -q -F -- 'redeploy_image_uri:' "$path" || return 1

  block="$(awk '
    /^  resolve-existing-image:/ { started = 1 }
    started && /^  deploy-staging:/ { exit }
    started { print }
  ' "$path")"
  [[ "$block" == *'needs: build-test'* ]] || return 1
  [[ "$block" == *'ecr:DescribeImages'* || "$block" == *'describe-images'* ]] || return 1
  [[ "$block" == *"exit-code: '1'"* ]] || return 1
  [[ "$block" == *'if: always()'* ]] || return 1
  [[ "$block" != *"$DOCKER_BUILD_CMD"* && "$block" != *"$DOCKER_PUSH_CMD"* ]] || return 1
  local resolve_line scan_line summary_line upload_line
  resolve_line="$(rg -n -F -- 'aws ecr describe-images' "$path" | tail -1 | cut -d: -f1)"
  scan_line="$(rg -n -F -- 'Scan existing backend image' "$path" | tail -1 | cut -d: -f1)"
  summary_line="$(rg -n -F -- 'Summarize existing backend image scan' "$path" | tail -1 | cut -d: -f1)"
  upload_line="$(rg -n -F -- 'Upload existing backend Trivy report' "$path" | tail -1 | cut -d: -f1)"
  [[ -n "$resolve_line" && -n "$scan_line" && -n "$summary_line" && -n "$upload_line" ]] || return 1
  [[ "$resolve_line" -lt "$scan_line" && "$scan_line" -lt "$summary_line" && "$summary_line" -lt "$upload_line" ]] || return 1
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
    missing-digest-capture)
      sed '/RepoDigests/d' "$path" >"$path.next"
      mv "$path.next" "$path"
      ;;
    missing-run-id-output)
      sed '/run_id=/d' "$path" >"$path.next"
      mv "$path.next" "$path"
      ;;
    invalid-repository)
      replace_fixture_text "$path" 'crewsafe/backend' 'crewsafe/unrelated'
      ;;
    invalid-role)
      replace_fixture_text "$path" 'crewsafe-shared-dev-ecr-push' 'crewsafe-shared-dev-ecr-web-push'
      ;;
    malformed-tag)
      replace_fixture_text "$path" '{40}' '{39}'
      ;;
    missing-redeploy-exclusion)
      replace_fixture_text "$path" 'inputs.redeploy && !inputs.publish' 'inputs.redeploy'
      ;;
    malformed-redeploy-tag)
      replace_fixture_text "$path" 'redeploy_image_tag' 'redeploy_image_ref'
      ;;
    missing-ancestry-check)
      sed '/git merge-base --is-ancestor/d' "$path" >"$path.next"
      mv "$path.next" "$path"
      ;;
    arbitrary-image-input)
      printf '\n    redeploy_image_uri:\n      description: arbitrary image URI\n      type: string\n' >>"$path"
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

assert_rejected_redeploy_fixture() {
  local label="$1" mutation="$2"
  local fixture
  fixture="$(mktemp)"
  TMP_DIRS+=("$fixture")
  cp "$WORKFLOW" "$fixture"
  mutate_fixture "$fixture" "$mutation"
  TESTS_RUN=$((TESTS_RUN + 1))
  if ! redeploy_policy_guard "$fixture"; then
    pass "$label"
  else
    fail "$label" "redeploy policy guard accepted mutation: $mutation"
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

# --- SCRUM-242 US3: post-apply immutable-image replay ---------------------
contains_in "manual redeploy input exists" "$WORKFLOW" 'redeploy:'
contains_in "redeploy resolves an existing image job" "$WORKFLOW" 'resolve-existing-image:'

# --- US1 AS1/AS2: blocking scan step present, correctly configured
contains_in "publication builds backend image" "$WORKFLOW" "$DOCKER_BUILD_CMD"
contains_in "publication scans image" "$WORKFLOW" 'aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25'
contains_in "scan uses HIGH,CRITICAL severity" "$WORKFLOW" 'severity: HIGH,CRITICAL'
contains_in "scan is vulnerability-only" "$WORKFLOW" 'scanners: vuln'
contains_in "scan emits a JSON report" "$WORKFLOW" 'format: json'
contains_in "scan writes the JSON report" "$WORKFLOW" 'output: trivy-backend-report.json'
contains_in "scan does not ignore unfixed findings" "$WORKFLOW" 'ignore-unfixed: false'
contains_in "scan is blocking (FR-008)" "$WORKFLOW" "exit-code: '1'"
not_contains_in "scan is not report-only" "$WORKFLOW" "exit-code: '0'"
contains_in "publication pushes image" "$WORKFLOW" "$DOCKER_PUSH_CMD"
not_contains_in "workflow has no static AWS access key" "$WORKFLOW" 'AWS_ACCESS_KEY_ID'
not_contains_in "workflow has no static AWS secret key" "$WORKFLOW" 'AWS_SECRET_ACCESS_KEY'
not_contains_in "workflow has no continue-on-error" "$WORKFLOW" 'continue-on-error:'
not_contains_in_build_test "validation job has no OIDC permission" 'id-token: write'
not_contains_in_build_test "validation job has no AWS credential action" 'configure-aws-credentials'
not_contains_in_build_test "validation job has no image push" "$DOCKER_PUSH_CMD"

assert_order "build -> scan -> summary -> AWS credentials -> login -> push -> digest" "$WORKFLOW" \
  "$DOCKER_BUILD_CMD" "$TRIVY_ACTION" 'Summarize backend image scan' 'configure-aws-credentials' 'aws ecr get-login-password' "$DOCKER_PUSH_CMD" 'RepoDigests'

# --- SCRUM-270 US1 (T002): digest capture, job outputs, job summary -------
contains_in "publication captures the pushed digest" "$WORKFLOW" 'RepoDigests'
contains_in "publication validates digest shape" "$WORKFLOW" 'sha256:[0-9a-f]{64}'
contains_in "publication writes job outputs" "$WORKFLOW" 'GITHUB_OUTPUT'
contains_in "publication writes job summary" "$WORKFLOW" 'GITHUB_STEP_SUMMARY'
contains_in "publication output declares image_uri" "$WORKFLOW" "image_uri=\$REPO:\$SHA"
contains_in "publication output declares image_tag" "$WORKFLOW" "image_tag=\$SHA"
contains_in "publication output declares image_digest" "$WORKFLOW" "image_digest=\$image_digest"
contains_in "publication output declares run_id" "$WORKFLOW" "run_id=\$GITHUB_RUN_ID"
contains_in "publication output declares run_url" "$WORKFLOW" "run_url=\$GITHUB_SERVER_URL"
contains_in "publication job exposes image_uri output" "$WORKFLOW" "image_uri: \${{ steps.publish.outputs.image_uri }}"
contains_in "publication job exposes image_tag output" "$WORKFLOW" "image_tag: \${{ steps.publish.outputs.image_tag }}"
contains_in "publication job exposes image_digest output" "$WORKFLOW" "image_digest: \${{ steps.publish.outputs.image_digest }}"
contains_in "publication job exposes run_id output" "$WORKFLOW" "run_id: \${{ steps.publish.outputs.run_id }}"
contains_in "publication job exposes run_url output" "$WORKFLOW" "run_url: \${{ steps.publish.outputs.run_url }}"

# --- SCRUM-270 US2 (T007): contract validation before build ---------------
contains_in "publication validates the repository pattern" "$WORKFLOW" 'crewsafe/backend'
contains_in "publication validates the push role pattern" "$WORKFLOW" 'crewsafe-shared-dev-ecr-push'
contains_in "publication validates the commit SHA shape" "$WORKFLOW" '^[0-9a-f]{40}$'
assert_order "contract validation precedes build" "$WORKFLOW" \
  'Validate backend publication contract' "$DOCKER_BUILD_CMD"

# --- SCRUM-269 US3 (T034): ignorefile prep precedes the scan step ---------
contains_in "ignorefile prep step references the source exceptions file" "$WORKFLOW" \
  'backend-image.trivyignore.source'
contains_in "ignorefile prep step invokes filter-trivyignore.sh" "$WORKFLOW" \
  'filter-trivyignore.sh'
assert_order "ignorefile prep precedes the scan step" "$WORKFLOW" \
  'filter-trivyignore.sh' "$TRIVY_ACTION"
contains_in "scan step passes the active ignorefile via trivyignores" "$WORKFLOW" \
  'trivyignores: .trivyignore-active-backend'
contains_in "scan summary uses the shared redacted helper" "$WORKFLOW" \
  '.github/scripts/security/summarize-trivy-report.sh'
contains_in "scan summary writes to the GitHub job summary" "$WORKFLOW" \
  'GITHUB_STEP_SUMMARY'
contains_in "scan summary runs after a failed scan" "$WORKFLOW" \
  'if: always()'
contains_in "backend report is uploaded" "$WORKFLOW" \
  'name: trivy-backend-report'
assert_order "scan precedes summary" "$WORKFLOW" \
  "$TRIVY_ACTION" 'Summarize backend image scan'

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

# --- SCRUM-270 US1 (T003): digest/output negative/mutation tests ----------
assert_rejected_fixture "negative missing digest capture fixture is rejected" missing-digest-capture
assert_rejected_fixture "negative missing run_id output fixture is rejected" missing-run-id-output

# --- SCRUM-270 US2 (T008): contract-validation negative/mutation tests ----
assert_rejected_fixture "negative invalid repository fixture is rejected" invalid-repository
assert_rejected_fixture "negative invalid role fixture is rejected" invalid-role
assert_rejected_fixture "negative malformed tag fixture is rejected" malformed-tag

# --- SCRUM-242 US3: deploy-only safety mutations --------------------------
TESTS_RUN=$((TESTS_RUN + 1))
if redeploy_policy_guard "$WORKFLOW"; then
  pass "base workflow passes redeploy policy guard"
else
  fail "base workflow passes redeploy policy guard"
fi

assert_rejected_redeploy_fixture "negative missing redeploy exclusion fixture is rejected" missing-redeploy-exclusion
assert_rejected_redeploy_fixture "negative malformed redeploy tag fixture is rejected" malformed-redeploy-tag
assert_rejected_redeploy_fixture "negative missing ancestry check fixture is rejected" missing-ancestry-check
assert_rejected_redeploy_fixture "negative arbitrary image input fixture is rejected" arbitrary-image-input

printf '\n%d run, %d failed\n' "$TESTS_RUN" "$TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]
