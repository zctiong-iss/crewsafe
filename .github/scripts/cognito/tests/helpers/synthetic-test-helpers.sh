#!/usr/bin/env bash
set -euo pipefail

TEST_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
SYNTHETIC_RESOLVER="$TEST_ROOT/.github/scripts/cognito/resolve-synthetic-users.sh"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

assert_rejected() {
  local fixture="$1"
  shift
  if SYNTHETIC_USERS_FILE="$fixture" "$SYNTHETIC_RESOLVER" "$@" >/dev/null 2>&1; then
    fail "unsafe synthetic manifest was accepted: $fixture"
  fi
}

assert_no_sensitive_output() {
  local output="$1"
  if grep -Eiq 'password|temporary.?code|secret.?value|client.?secret|(access|refresh|id).?token|aws_access_key|BEGIN [A-Z ]+PRIVATE KEY' <<<"$output"; then
    fail "sensitive output marker detected"
  fi
}
