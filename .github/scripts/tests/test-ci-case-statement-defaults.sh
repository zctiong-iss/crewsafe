#!/usr/bin/env bash
# SCRUM-405: static regression coverage for two `case` statements that are impractical to
# exercise with a crafted bad value at runtime (see specs/041-ci-shell-case-defaults/research.md
# Decisions 2 and 4) -- one is unreachable-by-design behind an earlier guard in a script that
# mutates live Cognito state, the other lives inside a hardcoded two-value loop in a CI test
# script. Both are asserted via `rg` against the source text instead: a default (`*`) arm must
# exist in each `case` block.
set -euo pipefail

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/harness.sh"

reconcile_script="$REPO_ROOT/.github/scripts/cognito/reconcile-synthetic-users.sh"
mobile_test_script="$REPO_ROOT/.github/scripts/tests/test-mobile-native-build-workflow.sh"

require_executable "$reconcile_script" "reconcile-synthetic-users.sh"
require_executable "$mobile_test_script" "test-mobile-native-build-workflow.sh"

# --- reconcile-synthetic-users.sh: per-user `case "$operation" in` (SCRUM-405 FR-001) ----------
#
# Anchor on `admin-disable-user`, which only appears once in the file, inside the per-user loop's
# `disable-synthetic)` arm, immediately before that case block's `esac`. (The single-line
# four-way guard near the top of the script lists all four operation names on one line -- including
# the substring "disable-synthetic)" -- so anchoring on the arm header itself would ambiguously
# match both case statements.)
reconcile_block="$(rg -A20 -F -- 'admin-disable-user' "$reconcile_script" | rg -B20 -m1 -F -- 'esac')"
if echo "$reconcile_block" | rg -q -F -- '*)'; then
  _pass "SCRUM-405: reconcile-synthetic-users.sh per-user case has a default arm"
else
  _fail "SCRUM-405: reconcile-synthetic-users.sh per-user case has a default arm" \
    "expected a '*)' arm in the case \"\$operation\" in block"
fi
TESTS_RUN=$((TESTS_RUN + 1))

# --- test-mobile-native-build-workflow.sh: `case "$section_name" in` (SCRUM-405 FR-003) --------
#
# Anchor on the `ios) section="$ios_section" ;;` arm, which is unique in the file, through the
# next `esac`.
mobile_block="$(rg -A5 -F -- 'ios) section="$ios_section"' "$mobile_test_script" | rg -B5 -m1 -F -- 'esac')"
if echo "$mobile_block" | rg -q -F -- '*)'; then
  _pass "SCRUM-405: test-mobile-native-build-workflow.sh section case has a default arm"
else
  _fail "SCRUM-405: test-mobile-native-build-workflow.sh section case has a default arm" \
    "expected a '*)' arm in the case \"\$section_name\" in block"
fi
TESTS_RUN=$((TESTS_RUN + 1))

finish
