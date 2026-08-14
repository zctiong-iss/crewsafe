#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/.github/scripts/mobsf-dynamic/check-network-allowlist.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM
TESTS_RUN=0
TESTS_FAILED=0

pass() { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; TESTS_FAILED=$((TESTS_FAILED + 1)); }
expect() {
  local expected="$1" label="$2"
  shift 2
  TESTS_RUN=$((TESTS_RUN + 1))
  local actual=0
  "$@" >/dev/null 2>&1 || actual=$?
  if [[ "$actual" == "$expected" ]]; then pass "$label"; else fail "$label"; fi
}

printf 'test-check-network-allowlist\n'

allowlist="$WORK/network-allowlist.yml"
cat >"$allowlist" <<'YAML'
allowed_hosts:
  - "staging.example.cloudfront.net"
  - "*.auth.ap-southeast-1.amazoncognito.com"
YAML

# --- Every captured host is allowed: no flags, exit 0 ---
all_allowed_hosts="$WORK/all-allowed-hosts.txt"
cat >"$all_allowed_hosts" <<'EOF'
staging.example.cloudfront.net
abc123.auth.ap-southeast-1.amazoncognito.com
EOF
out1="$WORK/findings-allowed.json"
expect 0 'exits 0 when every captured host is allowed' "$SCRIPT" "$allowlist" "$all_allowed_hosts" "$out1"
TESTS_RUN=$((TESTS_RUN + 1))
if [[ -s "$out1" ]] && python3 -c "
import json,sys
d = json.load(open('$out1'))
assert d['out_of_allowlist'] == [], d
" 2>/dev/null; then
  pass 'findings report an empty out_of_allowlist list'
else
  fail 'findings report an empty out_of_allowlist list'
fi

# --- An out-of-allowlist host is recorded, but still exits 0 (FR-008: record, not block) ---
mixed_hosts="$WORK/mixed-hosts.txt"
cat >"$mixed_hosts" <<'EOF'
staging.example.cloudfront.net
evil.attacker.example
EOF
out2="$WORK/findings-mixed.json"
expect 0 'exits 0 even when an out-of-allowlist host is captured (record, not block)' "$SCRIPT" "$allowlist" "$mixed_hosts" "$out2"
TESTS_RUN=$((TESTS_RUN + 1))
if python3 -c "
import json
d = json.load(open('$out2'))
assert d['out_of_allowlist'] == ['evil.attacker.example'], d
" 2>/dev/null; then
  pass 'out-of-allowlist host is recorded in the findings output'
else
  fail 'out-of-allowlist host is recorded in the findings output'
fi

# --- Malformed / missing allowlist file fails closed ---
missing_allowlist="$WORK/does-not-exist.yml"
expect 1 'exits non-zero when the allowlist file is missing' "$SCRIPT" "$missing_allowlist" "$all_allowed_hosts" "$WORK/out-missing.json"

malformed_allowlist="$WORK/malformed.yml"
printf 'not: [valid, yaml' >"$malformed_allowlist"
expect 1 'exits non-zero when the allowlist file is malformed' "$SCRIPT" "$malformed_allowlist" "$all_allowed_hosts" "$WORK/out-malformed.json"

# --- Missing captured-hosts file fails closed ---
expect 1 'exits non-zero when the captured-hosts file is missing' "$SCRIPT" "$allowlist" "$WORK/no-such-hosts.txt" "$WORK/out-nohosts.json"

# --- ${CREWSAFE_BACKEND_HOST} placeholder is resolved from the environment before matching ---
placeholder_allowlist="$WORK/placeholder-allowlist.yml"
cat >"$placeholder_allowlist" <<'YAML'
allowed_hosts:
  - "${CREWSAFE_BACKEND_HOST}"
YAML
placeholder_hosts="$WORK/placeholder-hosts.txt"
echo 'staging-backend.example.cloudfront.net' >"$placeholder_hosts"
out3="$WORK/findings-placeholder.json"
TESTS_RUN=$((TESTS_RUN + 1))
if CREWSAFE_BACKEND_HOST='staging-backend.example.cloudfront.net' "$SCRIPT" "$placeholder_allowlist" "$placeholder_hosts" "$out3" >/dev/null 2>&1 \
  && python3 -c "
import json
d = json.load(open('$out3'))
assert d['out_of_allowlist'] == [], d
" 2>/dev/null; then
  pass 'resolves the ${CREWSAFE_BACKEND_HOST} placeholder from the environment before matching'
else
  fail 'resolves the ${CREWSAFE_BACKEND_HOST} placeholder from the environment before matching'
fi

printf '\n%d run, %d failed\n' "$TESTS_RUN" "$TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]
