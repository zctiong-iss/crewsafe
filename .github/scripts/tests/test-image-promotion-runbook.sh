#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
RUNBOOK="$ROOT/docs/runbooks/SCRUM-270-container-image-scan-gate.md"
TESTS_RUN=0
TESTS_FAILED=0

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

printf 'test-image-promotion-runbook\n'
check_file "runbook exists" "$RUNBOOK"

# --- contracts/promotion-rollback-runbook.md: 7 required section headings -
contains_in "has Overview section" "$RUNBOOK" '## 1. Overview'
contains_in "has Reference lookup section" "$RUNBOOK" '## 2. Reference lookup'
contains_in "has Promotion procedure section" "$RUNBOOK" '## 3. Promotion procedure'
contains_in "has Rollback procedure section" "$RUNBOOK" '## 4. Rollback procedure'
contains_in "has Report-only scope limitation section" "$RUNBOOK" '## 5. Report-only scope limitation'
contains_in "has Local/manual validation section" "$RUNBOOK" '## 6. Local/manual validation'
contains_in "has Failure and recovery section" "$RUNBOOK" '## 7. Failure and recovery'

# --- FR-007: reference lookup content --------------------------------------
contains_in "documents image_uri output" "$RUNBOOK" 'image_uri'
contains_in "documents image_digest output" "$RUNBOOK" 'image_digest'
contains_in "documents run_id/run_url output" "$RUNBOOK" 'run_id'

# --- FR-007: digest-only rollback rule --------------------------------------
contains_in "states rollback is digest-only" "$RUNBOOK" 'by digest'
contains_in "states a mutable tag/re-push MUST NOT be used for rollback" "$RUNBOOK" 'MUST NOT'

# --- FR-008: report-only scope limitation, linked to the binding decision --
contains_in "links the SCRUM-270/273 gate enforcement scope plan" "$RUNBOOK" \
  'docs/plans/SCRUM-270-273-gate-enforcement-scope-plan.md'
contains_in "states scan findings do not yet block publication" "$RUNBOOK" 'report-only'

printf '\n%d run, %d failed\n' "$TESTS_RUN" "$TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]
