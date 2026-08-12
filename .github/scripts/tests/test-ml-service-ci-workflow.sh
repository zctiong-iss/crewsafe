#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/ml-service-ci.yml"
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

pass() { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; TESTS_FAILED=$((TESTS_FAILED + 1)); }

check() {
  local label="$1"
  shift
  TESTS_RUN=$((TESTS_RUN + 1))
  if "$@"; then pass "$label"; else fail "$label"; fi
}

contains() { grep -q -F -- "$2" "$1"; }
not_contains() { ! grep -q -F -- "$2" "$1"; }

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
  contains "$path" 'contents: read' || return 1
  contains "$path" "group: ml-service-ci-\${{ github.workflow }}-\${{ github.ref }}" || return 1
  contains "$path" 'cancel-in-progress: true' || return 1
  contains "$path" 'actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd' || return 1
  contains "$path" 'actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065' || return 1
  contains "$path" 'aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25' || return 1
  contains "$path" 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a' || return 1
  contains "$path" 'python-version: "3.11"' || return 1
  contains "$path" 'python -m pip install --require-hashes -r requirements.txt' || return 1
  contains "$path" 'python -m pytest test_forecast.py' || return 1
  contains "$path" "docker build -t \"\$IMAGE\" ml-service" || return 1
  contains "$path" ".github/scripts/ci/run-ml-service-smoke.sh \"\$IMAGE\"" || return 1
  contains "$path" '.github/scripts/security/validate-ml-service-trivy-exceptions.sh' || return 1
  contains "$path" '.github/scripts/security/filter-trivyignore.sh' || return 1
  contains "$path" '.github/scripts/security/summarize-trivy-report.sh' || return 1
  contains "$path" 'scanners: vuln' || return 1
  contains "$path" 'severity: HIGH,CRITICAL' || return 1
  contains "$path" "exit-code: '0'" || return 1
  not_contains "$path" "exit-code: '1'" || return 1
  contains "$path" 'if-no-files-found: error' || return 1
  contains "$path" 'retention-days: 7' || return 1
  contains "$path" 'Run ML-service CI self-tests' || return 1
  contains "$path" 'test-ml-service-ci-workflow.sh' || return 1
  contains "$path" 'test-ml-service-smoke.sh' || return 1
  contains "$path" 'test-validate-ml-service-trivy-exceptions.sh' || return 1
  contains "$path" 'test-summarize-trivy-report.sh' || return 1
  not_contains "$path" 'continue-on-error:' || return 1
  not_contains "$path" 'configure-aws-credentials' || return 1
  not_contains "$path" 'aws ecr' || return 1
  not_contains "$path" 'docker login' || return 1
  not_contains "$path" 'docker push' || return 1
  not_contains "$path" 'AWS_ACCESS_KEY_ID' || return 1
  not_contains "$path" 'AWS_SECRET_ACCESS_KEY' || return 1
  if grep -nE 'uses: .+@' "$path" | grep -Ev '@[0-9a-f]{40}$' >/dev/null; then return 1; fi
  ordered "$path" \
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
    "exit-code: '0'|exit-code: '1'" \
    'if-no-files-found: error|if-no-files-found: ignore' \
    'contents: read|contents: write' \
    '"ml-service/**"|"web/**"'; do
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
