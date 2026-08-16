#!/usr/bin/env bash
# Gate self-tests for .github/scripts/security/report-findings.sh (SCRUM-178).
#
# Covers FR-008 (findings visible on the PR), FR-010 (redaction), SEC-002
# (untrusted content cannot forge workflow commands), and the requirement that
# "ran and found nothing" reads differently from "did not run".
set -euo pipefail

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/harness.sh"

REPORT="$REPO_ROOT/.github/scripts/security/report-findings.sh"

printf 'test-report-findings\n'

require_executable "$REPORT" "report-findings.sh"

tmp="$(make_tmpdir)"

write_findings() {
  local name="$1" content="$2"
  printf '%s' "$content" >"$tmp/$name"
  printf '%s' "$tmp/$name"
}

# --- blocking finding -------------------------------------------------------

blocking="$(write_findings blocking.json '[{
  "tool":"gitleaks","rule_id":"aws-access-token","severity":"HIGH",
  "file":"config/app.properties","line":12,"commit":"abc123",
  "message":"AWS Access Token","blocking":true
}]')"

out="$("$REPORT" --in "$blocking" --tool gitleaks --scope "abc..def" --status 1 2>&1)"

assert_contains "$out" "::error file=config/app.properties,line=12" \
  "blocking finding emits an ::error annotation with file and line"
assert_contains "$out" "aws-access-token" \
  "annotation carries the rule id"
assert_contains "$out" "abc..def" \
  "summary states the scope that was scanned"

# --- advisory finding -------------------------------------------------------

advisory="$(write_findings advisory.json '[{
  "tool":"gitleaks","rule_id":"generic-api-key","severity":"MEDIUM",
  "file":"src/Main.java","line":3,"commit":"","message":"Generic key",
  "blocking":false
}]')"

out_adv="$("$REPORT" --in "$advisory" --tool gitleaks --scope "full history" --status 0 2>&1)"

assert_contains "$out_adv" "::warning file=src/Main.java,line=3" \
  "advisory finding emits ::warning, not ::error"
assert_not_contains "$out_adv" "::error file=src/Main.java" \
  "advisory finding does not emit ::error"

# --- clean run must not read like a skipped run (SEC-004) -------------------

empty="$(write_findings empty.json '[]')"
out_clean="$("$REPORT" --in "$empty" --tool gitleaks --scope "full history" --status 0 2>&1)"

assert_contains "$out_clean" "0 blocking finding" \
  "clean run states zero blocking findings"
TESTS_RUN=$((TESTS_RUN + 1))
if [[ "$out_clean" == *"ran"* || "$out_clean" == *"Ran"* ]]; then
  _pass "clean run states that the gate actually ran"
else
  _fail "clean run states that the gate actually ran" \
    "summary must distinguish 'ran and found nothing' from 'did not run'"
fi

# --- scanner error is not a code finding (REL-002) --------------------------

out_err="$("$REPORT" --in "$empty" --tool gitleaks --scope "full history" --status 2 2>&1)"
assert_contains "$out_err" "infrastructure" \
  "status 2 names an infrastructure failure, not a code finding"

# --- SEC-002: untrusted content cannot forge a workflow command -------------
# A crafted path or rule message must not be able to emit its own workflow
# command. The dangerous case is ::stop-commands::, which would suppress every
# annotation after it -- turning an escaping bug into a way to hide findings.

evil="$(write_findings evil.json '[{
  "tool":"gitleaks","rule_id":"x","severity":"HIGH",
  "file":"a.txt\n::stop-commands::deadbeef","line":1,"commit":"",
  "message":"pwn::error file=fake.txt,line=99::forged","blocking":true
},{
  "tool":"gitleaks","rule_id":"real-rule","severity":"HIGH",
  "file":"real.txt","line":7,"commit":"","message":"genuine finding",
  "blocking":true
}]')"

out_evil="$("$REPORT" --in "$evil" --tool gitleaks --scope "s" --status 1 2>&1)"

assert_not_contains "$out_evil" "::stop-commands::" \
  "injected ::stop-commands:: is neutralized"
assert_contains "$out_evil" "real.txt" \
  "a genuine finding after a hostile one is still reported"

TESTS_RUN=$((TESTS_RUN + 1))
if [[ "$(grep -c '^::error file=fake.txt' <<<"$out_evil" || true)" == "0" ]]; then
  _pass "injected annotation is not emitted as its own workflow command"
else
  _fail "injected annotation is not emitted as its own workflow command"
fi

# --- argument validation ----------------------------------------------------

assert_exit 0 "reporter exits 0 even for a failing scan (never masks a verdict)" \
  "$REPORT" --in "$blocking" --tool gitleaks --scope "s" --status 1

finish
