#!/usr/bin/env bash
set -euo pipefail

# SCRUM-350. Redacts credential-shaped content from a MobSF report / network-findings
# summary / Maestro log before it is ever uploaded or written to $GITHUB_STEP_SUMMARY
# (FR-006, SEC-003). Adapts the same regex classes already proven in
# run-authenticated-dast.sh's redacted_zap_diagnostic (passwords, tokens, cookies,
# Authorization headers, Bearer tokens, JWTs, emails), plus optional known-secret-value
# literal redaction for the actual live credential(s) used in the run.
#
# Fails closed: if a self-check after redaction still finds a credential-shaped pattern, OR
# still finds a known-secret-value (checked case-insensitively, since exact-case literal
# substitution alone could miss an unexpectedly-cased occurrence in raw tool output), nothing
# is written to <output-file> and the script exits non-zero (Edge Cases, SEC-003).
#
# Usage: sanitize-mobsf-report.sh <input-file> <output-file> [known-secret-value ...]

usage() {
  echo "usage: $(basename "$0") <input-file> <output-file> [known-secret-value ...]" >&2
}

if [[ $# -lt 2 ]]; then
  usage
  exit 1
fi

input_path="$1"
output_path="$2"
shift 2
known_secrets=("$@")

fail() {
  echo "sanitize-mobsf-report.sh: $1" >&2
  rm -f "$output_path"
  exit 1
}

[[ -r "$input_path" ]] || fail "input file not found or unreadable: $input_path"

content="$(cat "$input_path")"

# Regex-pattern redaction (same classes as run-authenticated-dast.sh's
# redacted_zap_diagnostic): password/token/cookie/authorization/username/secret assignments,
# Bearer tokens, JWT-shaped three-segment strings, email addresses. The replacement is a bare
# "[redacted]" -- deliberately dropping the matched trigger keyword (unlike
# redacted_zap_diagnostic's "\1=[redacted]") so the self-check below can reuse the exact same
# patterns without the redaction's own output ("authorization=[redacted]") re-matching its
# own "keyword[:=]value" shape.
content="$(printf '%s' "$content" | sed -E \
  -e 's#(password|token|cookie|authorization|username|secret|access_token|refresh_token)[^:="'"'"']*[:=][[:space:]]*"?[^",;[:space:]]+"?#[redacted]#Ig' \
  -e 's#Bearer[[:space:]]+[A-Za-z0-9._~+/=-]+#[redacted]#Ig' \
  -e 's#[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}#<redacted-jwt>#g' \
  -e 's#[[:alnum:]._%+-]+@[[:alnum:].-]+\.[A-Za-z]{2,}#<redacted-email>#g')"

# Known-secret literal redaction: the actual live credential value(s) used in this run,
# passed by the caller (e.g. the synthetic Cognito password). Exact-case substring
# replacement -- the common case, since the caller passes the value verbatim.
for secret in "${known_secrets[@]+"${known_secrets[@]}"}"; do
  [[ -n "$secret" ]] || continue
  content="${content//"$secret"/[redacted]}"
done

# Self-check: refuse to write anything unless we can confirm the redaction actually worked.
if printf '%s' "$content" | grep -Eqi '(password|token|cookie|authorization|secret|access_token|refresh_token)[^:="'"'"']*[:=][[:space:]]*"?[^",;[:space:]]+"?' \
  || printf '%s' "$content" | grep -Eq 'Bearer[[:space:]]+[A-Za-z0-9._~+/=-]+' \
  || printf '%s' "$content" | grep -Eq '[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}' \
  || printf '%s' "$content" | grep -Eq '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[A-Za-z]{2,}'; then
  fail "cannot confirm all credential-shaped patterns were redacted -- refusing to write unsanitized output"
fi

for secret in "${known_secrets[@]+"${known_secrets[@]}"}"; do
  [[ -n "$secret" ]] || continue
  # Case-insensitive verification, independent of the case-sensitive replacement above --
  # catches a differently-cased occurrence (e.g. an uppercase log dump) the exact-case
  # substitution would otherwise miss.
  if printf '%s' "$content" | grep -qiF -- "$secret"; then
    fail "a known-secret value may still be present after redaction (case-insensitive check) -- refusing to write unsanitized output"
  fi
done

printf '%s' "$content" >"$output_path"
