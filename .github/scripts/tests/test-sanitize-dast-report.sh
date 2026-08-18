#!/usr/bin/env bash
# Contract tests for the SCRUM-453 DAST report sanitizer.
set -euo pipefail

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/harness.sh"

SANITIZER="$REPO_ROOT/.github/scripts/security/sanitize-dast-report.sh"
printf 'test-sanitize-dast-report\n'

tmp="$(make_tmpdir)"
raw="$tmp/raw.json"
redacted="$tmp/dast-report-redacted.json"
malformed="$tmp/malformed.json"
zero="$tmp/zero.json"
secret="$(synthetic_generic_secret)"

jq -n \
  --arg secret "$secret" \
  '{
    "@programName": "ZAP",
    "@version": "2.17.0",
    "@generated": "Tue, 18 Aug 2026 10:00:00",
    created: "2026-08-18T10:00:00Z",
    site: [{
      "@name": "https://web.example.invalid",
      "@host": "web.example.invalid",
      alerts: [{
        pluginid: "10038",
        alert: "Content Security Policy (CSP) Header Not Set",
        riskcode: "2",
        riskdesc: "Medium (Medium)",
        confidence: "3",
        cweid: "693",
        instances: [{
          uri: "https://web.example.invalid/oauth/callback?code=authorization-code&state=state-value",
          param: "access_token",
          attack: ("Bearer " + $secret),
          evidence: ("session=" + $secret),
          otherinfo: "person@example.invalid",
          requestHeader: ("Authorization: Bearer " + $secret),
          responseBody: "untrusted response body"
        }]
      }]
    }],
    insights: [{ key: "insight.endpoint.total", statistic: "4" }]
  }' >"$raw"

printf '{not-json}\n' >"$malformed"
jq -n '{"@version":"2.17.0","@generated":"Tue, 18 Aug 2026 10:00:00",site:[],insights:[{key:"insight.endpoint.total",statistic:"0"}]}' >"$zero"

# The implementation is intentionally absent when this test is first written.
# These assertions must fail before T006 and pass after it.
assert_exit 0 "valid report is sanitized" env DAST_ENVIRONMENT=staging "$SANITIZER" "$raw" "$redacted"
assert_exit 0 "sanitized output is valid JSON" jq -e '.redaction.status == "complete"' "$redacted"
assert_exit 0 "sanitized output declares staging environment" jq -e '.environment == "staging"' "$redacted"
assert_exit 0 "sanitized output preserves the ZAP scanner version" jq -e '.scanner.version == "2.17.0"' "$redacted"
assert_exit 0 "sanitized output preserves the ZAP report timestamp" jq -e '.generated_at == "Tue, 18 Aug 2026 10:00:00"' "$redacted"
assert_exit 0 "sanitized output preserves endpoint coverage" jq -e '.coverage.endpoints == 4' "$redacted"
assert_exit 0 "sanitized output preserves medium finding count" jq -e '.finding_counts.medium == 1' "$redacted"
assert_exit 0 "sanitized output preserves the site host" jq -e '.findings[0].host == "web.example.invalid"' "$redacted"
assert_exit 0 "sanitized output strips query parameters" jq -e '.findings[0].paths == ["/oauth/callback"]' "$redacted"
assert_exit 0 "sanitized output excludes forbidden evidence fields" sh -c '! jq -e "[.. | objects | keys[]] | any(. == \"param\" or . == \"attack\" or . == \"evidence\" or . == \"otherinfo\" or . == \"requestHeader\" or . == \"responseBody\")" "$1" >/dev/null' sh "$redacted"
assert_exit 0 "sanitized output excludes the synthetic secret" sh -c '! rg -F -- "$1" "$2"' sh "$secret" "$redacted"
assert_exit 1 "malformed report fails closed" env DAST_ENVIRONMENT=staging "$SANITIZER" "$malformed" "$tmp/malformed-redacted.json"
assert_exit 1 "zero-coverage report fails closed" env DAST_ENVIRONMENT=staging "$SANITIZER" "$zero" "$tmp/zero-redacted.json"
assert_exit 0 "failed sanitization does not leave an output" test ! -e "$tmp/malformed-redacted.json"
assert_exit 0 "zero-coverage sanitization does not leave an output" test ! -e "$tmp/zero-redacted.json"

finish
