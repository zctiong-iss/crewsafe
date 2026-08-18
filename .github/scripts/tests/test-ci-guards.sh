#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SECURITY_WORKFLOW="$ROOT/.github/workflows/security-scan.yml"
BACKEND_WORKFLOW="$ROOT/.github/workflows/backend-ci.yml"
ML_WORKFLOW="$ROOT/.github/workflows/ml-service-ci.yml"
TESTS_RUN=0
TESTS_FAILED=0

pass() { local label="$1"; printf '  ok   %s\n' "$label"; }
fail() { local label="$1"; printf '  FAIL %s\n' "$label"; TESTS_FAILED=$((TESTS_FAILED + 1)); }

contains() {
  local label="$1" path="$2" needle="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if rg -q -F -- "$needle" "$path"; then pass "$label"; else fail "$label"; fi
}

not_contains() {
  local label="$1" path="$2" needle="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if ! rg -q -F -- "$needle" "$path"; then pass "$label"; else fail "$label"; fi
}

path_filter_count_at_least_two() {
  local label="$1" path="$2" needle="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  local count
  count="$(rg -n -F -- "$needle" "$path" | wc -l | tr -d ' ')"
  if [[ "$count" -ge 2 ]]; then pass "$label"; else fail "$label"; fi
}

printf 'test-ci-guards\n'

for path in "$SECURITY_WORKFLOW" "$BACKEND_WORKFLOW" "$ML_WORKFLOW"; do
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ -f "$path" ]]; then pass "workflow exists: $(basename "$path")"; else fail "workflow exists: $(basename "$path")"; fi
done

for test_path in \
  '.github/scripts/tests/test-backend-image-workflow.sh' \
  '.github/scripts/tests/test-ml-service-ci-workflow.sh' \
  '.github/scripts/tests/test-resolve-trivy-policy-mode.sh' \
  '.github/scripts/tests/test-summarize-trivy-report.sh' \
  '.github/scripts/tests/test-filter-trivyignore.sh' \
  '.github/scripts/tests/test-validate-trivy-exceptions.sh' \
  '.github/scripts/tests/test-validate-ml-service-trivy-exceptions.sh'; do
  contains "security-scan wires $test_path" "$SECURITY_WORKFLOW" "$test_path"
done

contains 'security-scan runs the policy helper test' "$SECURITY_WORKFLOW" 'run: .github/scripts/tests/test-resolve-trivy-policy-mode.sh'
contains 'security-scan runs the CI guard test' "$SECURITY_WORKFLOW" 'run: .github/scripts/tests/test-ci-guards.sh'

for workflow in "$BACKEND_WORKFLOW" "$ML_WORKFLOW"; do
  contains "$(basename "$workflow") filters policy helper" "$workflow" '.github/scripts/security/resolve-trivy-policy-mode.sh'
  contains "$(basename "$workflow") filters policy helper test" "$workflow" '.github/scripts/tests/test-resolve-trivy-policy-mode.sh'
  contains "$(basename "$workflow") filters CI guard test" "$workflow" '.github/scripts/tests/test-ci-guards.sh'
  not_contains "$(basename "$workflow") has no continue-on-error" "$workflow" 'continue-on-error:'
  if rg -n 'uses: .+@' "$workflow" | rg -v '@[0-9a-f]{40}$' >/dev/null; then
    fail "$(basename "$workflow") action references are SHA pinned"
    TESTS_RUN=$((TESTS_RUN + 1))
  else
    TESTS_RUN=$((TESTS_RUN + 1)); pass "$(basename "$workflow") action references are SHA pinned"
  fi
done

path_filter_count_at_least_two 'backend workflow has policy helper in both triggers' "$BACKEND_WORKFLOW" '.github/scripts/security/resolve-trivy-policy-mode.sh'
path_filter_count_at_least_two 'ML workflow has policy helper in both triggers' "$ML_WORKFLOW" '.github/scripts/security/resolve-trivy-policy-mode.sh'

printf '%s tests, %s failed\n' "$TESTS_RUN" "$TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]
