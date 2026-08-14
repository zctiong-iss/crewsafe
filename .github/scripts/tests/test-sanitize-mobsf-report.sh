#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/.github/scripts/mobsf-dynamic/sanitize-mobsf-report.sh"
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

# Runtime-generated credential-shaped fixtures -- never committed as static literals.
# .gitleaks.toml is explicit: "Never add an entry to accommodate a test fixture. [...]
# generate synthetic credentials at runtime [...] so no secret-shaped fixture is committed
# and none needs allowlisting." Mirrors .github/scripts/tests/lib/harness.sh's synthetic_*
# helpers, which this test doesn't source directly (that harness's throwaway-git-repo
# machinery is built for the SCRUM-178 gate tests specifically; this test only needs
# runtime-generated text, not a disposable repo).
random_chars() {
  local count="$1" class="$2" raw
  raw="$(head -c 1024 /dev/urandom | LC_ALL=C tr -dc "$class")"
  if [[ ${#raw} -lt $count ]]; then
    printf 'random_chars drew %d chars, needed %d\n' "${#raw}" "$count" >&2
    return 1
  fi
  printf '%s' "${raw:0:count}"
}
synthetic_jwt() {
  printf '%s.%s.%s' \
    "$(random_chars 24 'A-Za-z0-9_-')" \
    "$(random_chars 28 'A-Za-z0-9_-')" \
    "$(random_chars 40 'A-Za-z0-9_-')"
}
synthetic_api_key() {
  # sk_test_ + 32 random alphanumerics -- Stripe's test-mode key shape, the same one
  # harness.sh's synthetic_generic_secret uses and documents as reliably (not
  # entropy-flakily) detected by gitleaks, unlike a same-length AKIA-style key.
  printf 'sk_test_%s' "$(random_chars 32 'a-zA-Z0-9')"
}

printf 'test-sanitize-mobsf-report\n'

# --- Regex-pattern redaction: password, Bearer token, JWT-shaped string, email ---
jwt_fixture="$(synthetic_jwt)"
raw="$WORK/raw.json"
cat >"$raw" <<EOF
{
  "notes": "login with password=SuperSecret123!",
  "auth_header": "Authorization: Bearer ${jwt_fixture}",
  "user": "someone@synthetic.crewsafe.invalid"
}
EOF
out="$WORK/out.json"
expect 0 'exits 0 for a well-formed report with redactable content' "$SCRIPT" "$raw" "$out"

jwt_first_segment="${jwt_fixture%%.*}"
for needle in 'SuperSecret123!' "$jwt_first_segment" 'someone@synthetic.crewsafe.invalid'; do
  TESTS_RUN=$((TESTS_RUN + 1))
  if ! grep -qF -- "$needle" "$out" 2>/dev/null; then
    pass "redacts $needle from the output"
  else
    fail "redacts $needle from the output"
  fi
done

# --- Known-secret literal redaction (exact case) ---
api_key_fixture="$(synthetic_api_key)"
raw2="$WORK/raw2.json"
echo "{\"cookie\": \"session=abc; token=${api_key_fixture}\"}" >"$raw2"
out2="$WORK/out2.json"
expect 0 'exits 0 and redacts a known-secret literal value' "$SCRIPT" "$raw2" "$out2" "$api_key_fixture"
TESTS_RUN=$((TESTS_RUN + 1))
if ! grep -qF -- "$api_key_fixture" "$out2" 2>/dev/null; then
  pass 'known-secret literal value does not appear in the output'
else
  fail 'known-secret literal value does not appear in the output'
fi

# --- Fail-closed: a case-variant of a known-secret survives exact-case substitution, but
#     the case-insensitive verification pass must still catch it and refuse to write output ---
api_key_upper="$(printf '%s' "$api_key_fixture" | tr '[:lower:]' '[:upper:]')"
raw3="$WORK/raw3.json"
echo "{\"leaked\": \"${api_key_upper} appeared in an uppercase log dump\"}" >"$raw3"
out3="$WORK/out3.json"
rm -f "$out3"
expect 1 'exits non-zero when a case-variant of a known-secret cannot be confirmed redacted' "$SCRIPT" "$raw3" "$out3" "$api_key_fixture"
TESTS_RUN=$((TESTS_RUN + 1))
if [[ ! -e "$out3" ]]; then
  pass 'writes nothing to the output path when sanitization cannot be confirmed (fail-closed)'
else
  fail 'writes nothing to the output path when sanitization cannot be confirmed (fail-closed)'
fi

# --- Missing input file fails closed ---
expect 1 'exits non-zero when the input file is missing' "$SCRIPT" "$WORK/does-not-exist.json" "$WORK/out4.json"

printf '\n%d run, %d failed\n' "$TESTS_RUN" "$TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]
