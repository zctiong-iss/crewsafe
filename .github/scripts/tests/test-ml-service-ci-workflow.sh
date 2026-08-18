#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/ml-service-ci.yml"
readonly VALIDATE_TRIVY_EXCEPTIONS_SCRIPT='.github/scripts/security/validate-trivy-exceptions.sh'
TESTS_RUN=0
TESTS_FAILED=0
TMP_DIRS=()

cleanup() {
  local dir
  for dir in "${TMP_DIRS[@]:-}"; do
    [[ -n "$dir" && -d "$dir" ]] && rm -rf "$dir"
  done
  return 0
}
trap cleanup EXIT INT TERM

pass() { local label="$1"; printf '  ok   %s\n' "$label"; }
fail() { local label="$1"; printf '  FAIL %s\n' "$label"; TESTS_FAILED=$((TESTS_FAILED + 1)); }

check() {
  local label="$1"
  shift
  TESTS_RUN=$((TESTS_RUN + 1))
  if "$@"; then pass "$label"; else fail "$label"; fi
}

contains() { local file="$1" needle="$2"; grep -q -F -- "$needle" "$file"; }
not_contains() { local file="$1" needle="$2"; ! grep -q -F -- "$needle" "$file"; }

path_filter_count_at_least_two() {
  local file="$1" needle="$2"
  awk -v needle="$needle" '
    /^    paths:$/ { in_paths = 1; next }
    in_paths && /^  [A-Za-z0-9_-]+:$/ { in_paths = 0 }
    in_paths && index($0, needle) { count++ }
    END { exit !(count >= 2) }
  ' "$file"
}

ordered() {
  local file="$1"
  shift
  local previous=0 current needle
  for needle in "$@"; do
    current="$(awk -v needle="$needle" 'index($0, needle) { print NR; exit }' "$file")"
    [[ -n "$current" && "$current" -gt "$previous" ]] || return 1
    previous="$current"
  done
}

# Extracts a top-level job's block (its header line through, but not
# including, the next 2-space-indented job header or EOF) to a temp file.
# SCRUM-373 needs this because verify-ml-service and publish-image now carry
# opposite AWS-credential invariants — a whole-file grep can no longer tell
# them apart.
job_block() {
  local file="$1" job="$2" out="$3"
  awk -v job="  ${job}:" '
    $0 == job { found = 1; print; next }
    found && /^  [A-Za-z0-9_-]+:$/ { exit }
    found { print }
  ' "$file" >"$out"
}

workflow_policy_guard() {
  local path="$1"
  [[ -f "$path" ]] || return 1
  contains "$path" 'name: ML-service CI' || return 1
  contains "$path" 'pull_request:' || return 1
  contains "$path" 'push:' || return 1
  contains "$path" 'workflow_dispatch:' || return 1
  contains "$path" 'branches: [main]' || return 1
  contains "$path" '"ml-service/**"' || return 1
  contains "$path" '".github/workflows/ml-service-ci.yml"' || return 1
  contains "$path" "$VALIDATE_TRIVY_EXCEPTIONS_SCRIPT" || return 1
  path_filter_count_at_least_two "$path" '.github/scripts/deploy/deploy-ml-service-staging.sh' || return 1
  contains "$path" '.github/scripts/tests/test-validate-trivy-exceptions.sh' || return 1
  contains "$path" 'contents: read' || return 1
  contains "$path" "group: ml-service-ci-\${{ github.workflow }}-\${{ github.ref }}" || return 1
  contains "$path" 'cancel-in-progress: true' || return 1
  contains "$path" 'actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd' || return 1
  contains "$path" 'actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065' || return 1
  contains "$path" 'aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25' || return 1
  contains "$path" 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a' || return 1
  if grep -nE 'uses: .+@' "$path" | grep -Ev '@[0-9a-f]{40}$' >/dev/null; then return 1; fi

  local verify_job publish_job resolve_job deploy_job
  verify_job="$(mktemp)"
  publish_job="$(mktemp)"
  resolve_job="$(mktemp)"
  deploy_job="$(mktemp)"
  TMP_DIRS+=("$verify_job" "$publish_job" "$resolve_job" "$deploy_job")
  job_block "$path" "verify-ml-service" "$verify_job"
  job_block "$path" "publish-image" "$publish_job"
  job_block "$path" "resolve-existing-image" "$resolve_job"
  job_block "$path" "deploy-staging" "$deploy_job"
  [[ -s "$verify_job" ]] || return 1
  [[ -s "$publish_job" ]] || return 1
  [[ -s "$resolve_job" ]] || return 1
  [[ -s "$deploy_job" ]] || return 1

  # Forbidden literals checked against all four job blocks below — named once
  # so each not_contains call reads what it's actually guarding against.
  local static_key_id='AWS_ACCESS_KEY_ID'
  local static_secret_key='AWS_SECRET_ACCESS_KEY'
  local soft_fail='continue-on-error:'

  # verify-ml-service is test-and-scan only. It must never gain the ability
  # to touch a real AWS account, or a workflow meant only to verify a PR would
  # become a second, unreviewed path to production credentials.
  contains "$verify_job" 'python-version: "3.11"' || return 1
  contains "$verify_job" 'python -m pip install --require-hashes -r requirements.txt' || return 1
  contains "$verify_job" 'python -m pytest test_forecast.py' || return 1
  contains "$verify_job" "docker build -t \"\$IMAGE\" ml-service" || return 1
  contains "$verify_job" ".github/scripts/ci/run-ml-service-smoke.sh \"\$IMAGE\"" || return 1
  contains "$verify_job" "$VALIDATE_TRIVY_EXCEPTIONS_SCRIPT" || return 1
  contains "$verify_job" '.github/scripts/security/filter-trivyignore.sh' || return 1
  contains "$verify_job" '.github/scripts/security/summarize-trivy-report.sh' || return 1
  contains "$verify_job" "image-ref: \"\${{ env.IMAGE }}\"" || return 1
  contains "$verify_job" 'trivyignores: .trivyignore-active-ml-service' || return 1
  not_contains "$verify_job" "image-ref: \"\$IMAGE\"" || return 1
  not_contains "$verify_job" 'ignorefile: .trivyignore-active-ml-service' || return 1
  contains "$verify_job" 'scanners: vuln' || return 1
  contains "$verify_job" 'severity: HIGH,CRITICAL' || return 1
  contains "$verify_job" "exit-code: '1'" || return 1
  not_contains "$verify_job" "exit-code: '0'" || return 1
  contains "$verify_job" 'if: always()' || return 1
  contains "$verify_job" 'if-no-files-found: error' || return 1
  contains "$verify_job" 'retention-days: 7' || return 1
  contains "$verify_job" 'Run ML-service CI self-tests' || return 1
  contains "$verify_job" 'test-ml-service-ci-workflow.sh' || return 1
  contains "$verify_job" 'test-ml-service-smoke.sh' || return 1
  contains "$verify_job" 'test-validate-ml-service-trivy-exceptions.sh' || return 1
  contains "$verify_job" 'test-validate-trivy-exceptions.sh' || return 1
  contains "$verify_job" 'test-summarize-trivy-report.sh' || return 1
  not_contains "$verify_job" "$soft_fail" || return 1
  not_contains "$verify_job" 'configure-aws-credentials' || return 1
  not_contains "$verify_job" 'aws ecr' || return 1
  not_contains "$verify_job" 'docker login' || return 1
  not_contains "$verify_job" 'docker push' || return 1
  not_contains "$verify_job" "$static_key_id" || return 1
  not_contains "$verify_job" "$static_secret_key" || return 1
  ordered "$verify_job" \
    'Run ML-service CI self-tests' \
    'Install ML-service dependencies' \
    'Run ML-service tests' \
    'Build ML-service image' \
    'Run ML-service container smoke checks' \
    'Validate ML-service Trivy exceptions' \
    'Prepare active ML-service Trivy ignorefile' \
    'Generate ML-service Trivy report' \
    'Summarize ML-service Trivy report' \
    'Upload ML-service Trivy report' || return 1

  # publish-image (SCRUM-373) is the one place in this workflow allowed to
  # touch AWS, and only via OIDC role assumption gated on both repo variables
  # being set — never a static key, never unconditionally on every push.
  contains "$publish_job" 'needs: verify-ml-service' || return 1
  contains "$publish_job" 'id-token: write' || return 1
  contains "$publish_job" "github.ref == 'refs/heads/main'" || return 1
  contains "$publish_job" "CREWSAFE_ML_SERVICE_ECR_PUSH_ROLE_ARN != ''" || return 1
  contains "$publish_job" "CREWSAFE_ML_SERVICE_ECR_REPOSITORY_URL != ''" || return 1
  contains "$publish_job" 'Validate ml-service publication contract' || return 1
  contains "$publish_job" 'CREWSAFE_ML_SERVICE_ECR_REPOSITORY_URL' || return 1
  contains "$publish_job" 'CREWSAFE_ML_SERVICE_ECR_PUSH_ROLE_ARN' || return 1
  contains "$publish_job" 'dkr\.ecr\.ap-southeast-1\.amazonaws\.com/crewsafe/ml-service' || return 1
  contains "$publish_job" 'crewsafe-shared-dev-ecr-ml-service-push' || return 1
  contains "$publish_job" "docker build -t \"\$REPO:\$SHA\" ml-service" || return 1
  contains "$publish_job" 'configure-aws-credentials@e6de054238d6b7531b4efff3b6587d9aade6a06c' || return 1
  contains "$publish_job" 'mask-aws-account-id: true' || return 1
  contains "$publish_job" 'aws ecr get-login-password' || return 1
  contains "$publish_job" 'docker login' || return 1
  contains "$publish_job" 'docker push "$REPO:$SHA"' || return 1
  contains "$publish_job" "$VALIDATE_TRIVY_EXCEPTIONS_SCRIPT" || return 1
  contains "$publish_job" "exit-code: '1'" || return 1
  not_contains "$publish_job" "exit-code: '0'" || return 1
  contains "$publish_job" 'if: always()' || return 1
  contains "$publish_job" 'name: trivy-ml-service-publish-report' || return 1
  contains "$publish_job" 'retention-days: 7' || return 1
  contains "$publish_job" 'image_digest=' || return 1
  contains "$publish_job" '!inputs.redeploy' || return 1
  not_contains "$publish_job" "$static_key_id" || return 1
  not_contains "$publish_job" "$static_secret_key" || return 1
  not_contains "$publish_job" "$soft_fail" || return 1

  # resolve-existing-image (SCRUM-373 follow-up) never builds or pushes — it
  # only proves a previously-published commit is a reachable main ancestor and
  # resolves its already-pushed digest, mirroring backend-ci.yml's own job.
  contains "$resolve_job" 'needs: verify-ml-service' || return 1
  contains "$resolve_job" 'id-token: write' || return 1
  contains "$resolve_job" "github.ref == 'refs/heads/main'" || return 1
  contains "$resolve_job" 'inputs.redeploy && !inputs.publish' || return 1
  contains "$resolve_job" "CREWSAFE_ML_SERVICE_DEPLOY_ROLE_ARN != ''" || return 1
  contains "$resolve_job" 'fetch-depth: 0' || return 1
  contains "$resolve_job" 'Validate existing-image redeploy contract' || return 1
  contains "$resolve_job" 'crewsafe-shared-dev-ml-service-deploy' || return 1
  contains "$resolve_job" 'git cat-file -e' || return 1
  contains "$resolve_job" 'git merge-base --is-ancestor' || return 1
  contains "$resolve_job" 'configure-aws-credentials@e6de054238d6b7531b4efff3b6587d9aade6a06c' || return 1
  contains "$resolve_job" 'mask-aws-account-id: true' || return 1
  contains "$resolve_job" 'aws ecr describe-images' || return 1
  contains "$resolve_job" "$VALIDATE_TRIVY_EXCEPTIONS_SCRIPT" || return 1
  contains "$resolve_job" 'IMAGE_TAG: ${{ inputs.redeploy_image_tag }}' || return 1
  not_contains "$resolve_job" '"$IMAGE" "${{ inputs.redeploy_image_tag }}"' || return 1
  contains "$resolve_job" '"$IMAGE" "$IMAGE_TAG"' || return 1
  contains "$resolve_job" 'aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25' || return 1
  contains "$resolve_job" 'image-ref: "${{ env.REPO }}@${{ steps.resolve.outputs.image_digest }}"' || return 1
  contains "$resolve_job" 'trivy-ml-service-redeploy-report.json' || return 1
  contains "$resolve_job" 'Scan existing ml-service image' || return 1
  contains "$resolve_job" 'Upload existing ml-service Trivy report' || return 1
  contains "$resolve_job" 'if: always()' || return 1
  not_contains "$resolve_job" 'docker build' || return 1
  not_contains "$resolve_job" 'docker push' || return 1
  not_contains "$resolve_job" "$static_key_id" || return 1
  not_contains "$resolve_job" "$static_secret_key" || return 1
  not_contains "$resolve_job" "$soft_fail" || return 1

  # deploy-staging (SCRUM-373 follow-up / SCRUM-455) accepts either a newly
  # published, gated image or a gated existing-image redeploy. It registers
  # the selected immutable digest against the shared backend task family and
  # force-deploys — it never touches the backend container's own image field
  # (deploy-ml-service-staging.sh owns that guarantee).
  contains "$deploy_job" 'needs: [publish-image, resolve-existing-image]' || return 1
  contains "$deploy_job" "needs.publish-image.result == 'success' || needs.resolve-existing-image.result == 'success'" || return 1
  contains "$deploy_job" 'IMAGE_TAG: ${{ needs.publish-image.outputs.image_tag || needs.resolve-existing-image.outputs.image_tag }}' || return 1
  contains "$deploy_job" 'IMAGE_DIGEST: ${{ needs.publish-image.outputs.image_digest || needs.resolve-existing-image.outputs.image_digest }}' || return 1
  contains "$deploy_job" 'id-token: write' || return 1
  contains "$deploy_job" 'CREWSAFE_ML_SERVICE_DEPLOY_ROLE_ARN' || return 1
  contains "$deploy_job" 'CREWSAFE_BACKEND_ECS_CLUSTER_NAME' || return 1
  contains "$deploy_job" 'CREWSAFE_BACKEND_ECS_SERVICE_NAME' || return 1
  contains "$deploy_job" 'crewsafe-shared-dev-ml-service-deploy' || return 1
  contains "$deploy_job" 'configure-aws-credentials@e6de054238d6b7531b4efff3b6587d9aade6a06c' || return 1
  contains "$deploy_job" 'mask-aws-account-id: true' || return 1
  contains "$deploy_job" 'deploy-ml-service-staging.sh' || return 1
  not_contains "$deploy_job" 'docker build' || return 1
  not_contains "$deploy_job" 'docker push' || return 1
  not_contains "$deploy_job" "$static_key_id" || return 1
  not_contains "$deploy_job" "$static_secret_key" || return 1
  not_contains "$deploy_job" "$soft_fail" || return 1

  local resolve_line scan_line summary_line upload_line
  resolve_line="$(awk 'index($0, "aws ecr describe-images") { print NR; exit }' "$resolve_job")"
  scan_line="$(awk 'index($0, "Scan existing ml-service image") { print NR; exit }' "$resolve_job")"
  summary_line="$(awk 'index($0, "Summarize existing ml-service image scan") { print NR; exit }' "$resolve_job")"
  upload_line="$(awk 'index($0, "Upload existing ml-service Trivy report") { print NR; exit }' "$resolve_job")"
  [[ -n "$resolve_line" && -n "$scan_line" && -n "$summary_line" && -n "$upload_line" ]] || return 1
  [[ "$resolve_line" -lt "$scan_line" && "$scan_line" -lt "$summary_line" && "$summary_line" -lt "$upload_line" ]] || return 1

  return 0
}

assert_mutation_rejected() {
  local label="$1" fixture="$2"
  TESTS_RUN=$((TESTS_RUN + 1))
  if ! workflow_policy_guard "$fixture"; then pass "$label"; else fail "$label"; fi
}

printf 'test-ml-service-ci-workflow\n'
check 'ML-service workflow exists' test -f "$WORKFLOW"
check 'workflow policy contract holds' workflow_policy_guard "$WORKFLOW"

if [[ -f "$WORKFLOW" ]]; then
  for mutation in \
    'scanners: vuln|scanners: secret' \
    "exit-code: '1'|exit-code: '0'" \
    'if-no-files-found: error|if-no-files-found: ignore' \
    'contents: read|contents: write' \
    '"ml-service/**"|"web/**"' \
    'needs: verify-ml-service|needs: []' \
    'needs: [publish-image, resolve-existing-image]|needs: resolve-existing-image' \
    'configure-aws-credentials@e6de054238d6b7531b4efff3b6587d9aade6a06c|configure-aws-credentials@0000000000000000000000000000000000000000'; do
    pattern="${mutation%%|*}"
    replacement="${mutation#*|}"
    fixture="$(mktemp)"
    TMP_DIRS+=("$fixture")
    awk -v from="$pattern" -v to="$replacement" '
      {
        position = index($0, from)
        if (position > 0) {
          $0 = substr($0, 1, position - 1) to substr($0, position + length(from))
        }
        print
      }
    ' "$WORKFLOW" >"$fixture"
    assert_mutation_rejected "rejects mutation: $replacement" "$fixture"
  done
fi

printf '%s tests, %s failed\n' "$TESTS_RUN" "$TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]
