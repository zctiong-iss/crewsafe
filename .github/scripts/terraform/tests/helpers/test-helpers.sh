#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
assert_file() { [[ -f "$ROOT/$1" ]] || fail "missing $1"; }
assert_contains() { grep -Fq -- "$2" "$ROOT/$1" || fail "$1 missing: $2"; }
assert_not_contains() {
  if grep -Fq -- "$2" "$ROOT/$1"; then
    fail "$1 contains forbidden: $2"
  fi
}
