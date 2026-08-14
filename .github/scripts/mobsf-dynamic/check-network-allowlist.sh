#!/usr/bin/env bash
set -euo pipefail

# SCRUM-350. Compares captured network traffic hosts from a dynamic-scan run against the
# declarative allowlist policy (.github/security/mobsf-dynamic/network-allowlist.yml).
# Out-of-allowlist destinations are RECORDED, never blocking (FR-008) -- a mid-flow network
# block would abort the scripted Maestro flow and produce a false "no coverage" failure
# indistinguishable from a genuinely broken run (Edge Cases, research.md R8).
#
# Usage: check-network-allowlist.sh <allowlist-yaml> <captured-hosts-file> <output-json>
# <captured-hosts-file> is a newline-separated list of hostnames actually contacted.
# Writes <output-json> with { "allowed_hosts": [...], "captured_hosts": [...],
# "out_of_allowlist": [...] }. Always exits 0 once inputs are valid, regardless of findings.

usage() {
  echo "usage: $(basename "$0") <allowlist-yaml> <captured-hosts-file> <output-json>" >&2
}

fail() {
  echo "check-network-allowlist.sh: $1" >&2
  exit 1
}

if [[ $# -ne 3 ]]; then
  usage
  exit 1
fi

allowlist_path="$1"
captured_hosts_path="$2"
output_path="$3"

[[ -r "$allowlist_path" ]] || fail "allowlist file not found or unreadable: $allowlist_path"
[[ -r "$captured_hosts_path" ]] || fail "captured-hosts file not found or unreadable: $captured_hosts_path"

# Minimal, dependency-free extraction of the `allowed_hosts:` YAML list -- this policy file
# is a flat list of quoted strings only (see network-allowlist.yml), not general YAML, so a
# full parser is unnecessary. Reject anything that doesn't look like that shape.
if ! grep -q '^allowed_hosts:' "$allowlist_path"; then
  fail "allowlist file is malformed: no top-level allowed_hosts: key found in $allowlist_path"
fi

allowed_patterns=()
while IFS= read -r line; do
  # Match lines like: `  - "some.host"` or `  - 'some.host'`
  if [[ "$line" =~ ^[[:space:]]*-[[:space:]]*[\"\'](.+)[\"\'][[:space:]]*$ ]]; then
    entry="${BASH_REMATCH[1]}"
    # Resolve the one known placeholder (e.g. "${CREWSAFE_BACKEND_HOST}") from the
    # environment, same envsubst mechanism run-authenticated-dast.sh already uses -- scoped
    # to a fixed variable list so an unrelated literal "$" in a future entry is never touched.
    if command -v envsubst >/dev/null 2>&1; then
      entry="$(CREWSAFE_BACKEND_HOST="${CREWSAFE_BACKEND_HOST:-}" envsubst '${CREWSAFE_BACKEND_HOST}' <<<"$entry")"
    fi
    allowed_patterns+=("$entry")
  fi
done <"$allowlist_path"

if [[ "${#allowed_patterns[@]}" -eq 0 ]]; then
  fail "allowlist file is malformed: allowed_hosts: has no valid entries in $allowlist_path"
fi

captured_hosts=()
while IFS= read -r host; do
  [[ -n "$host" ]] || continue
  captured_hosts+=("$host")
done <"$captured_hosts_path"

out_of_allowlist=()
for host in "${captured_hosts[@]+"${captured_hosts[@]}"}"; do
  matched=0
  for pattern in "${allowed_patterns[@]}"; do
    # Bash glob matching: unquoted $pattern lets `*` in an allowlist entry (e.g.
    # "*.auth.ap-southeast-1.amazoncognito.com") match any subdomain.
    # shellcheck disable=SC2053
    if [[ "$host" == $pattern ]]; then
      matched=1
      break
    fi
  done
  if [[ "$matched" -eq 0 ]]; then
    out_of_allowlist+=("$host")
  fi
done

json_array() {
  # json_array <element>... -> a JSON array of double-quoted strings, "" if no elements.
  local first=1
  printf '['
  for item in "$@"; do
    [[ "$first" -eq 1 ]] || printf ','
    first=0
    printf '"%s"' "$item"
  done
  printf ']'
}

{
  printf '{\n'
  printf '  "allowed_hosts": %s,\n' "$(json_array "${allowed_patterns[@]+"${allowed_patterns[@]}"}")"
  printf '  "captured_hosts": %s,\n' "$(json_array "${captured_hosts[@]+"${captured_hosts[@]}"}")"
  printf '  "out_of_allowlist": %s\n' "$(json_array "${out_of_allowlist[@]+"${out_of_allowlist[@]}"}")"
  printf '}\n'
} >"$output_path"

if [[ "${#out_of_allowlist[@]}" -gt 0 ]]; then
  echo "check-network-allowlist.sh: recorded ${#out_of_allowlist[@]} out-of-allowlist destination(s) -- see $output_path (FR-008: not blocking)" >&2
fi

exit 0
