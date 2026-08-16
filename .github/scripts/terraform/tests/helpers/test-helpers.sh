#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
assert_file() {
  local rel_path="$1"
  [[ -f "$ROOT/$rel_path" ]] || fail "missing $rel_path"
}
assert_contains() {
  local rel_path="$1" needle="$2"
  grep -Fq -- "$needle" "$ROOT/$rel_path" || fail "$rel_path missing: $needle"
}
assert_not_contains() {
  local rel_path="$1" needle="$2"
  if grep -Fq -- "$needle" "$ROOT/$rel_path"; then
    fail "$rel_path contains forbidden: $needle"
  fi
}
