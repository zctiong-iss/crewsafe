#!/usr/bin/env bash
set -euo pipefail

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/harness.sh"

SCRIPT="$REPO_ROOT/.github/scripts/security/import-sonar-securityhub.sh"
FIXTURES="$REPO_ROOT/.github/scripts/tests/fixtures/sonar-securityhub"

printf 'test-sonar-securityhub-import\n'
require_executable "$SCRIPT" "Sonar Security Hub importer"

work="$(make_tmpdir)"
mock_bin="$work/bin"
mkdir -p "$mock_bin"
ln -s "$FIXTURES/stub-curl.sh" "$mock_bin/curl"
ln -s "$FIXTURES/stub-aws.sh" "$mock_bin/aws"
chmod +x "$FIXTURES/stub-curl.sh" "$FIXTURES/stub-aws.sh"

config="$work/config.json"
cat >"$config" <<'JSON'
{"enabled":true,"sonarProjectKey":"zctiong-iss_crewsafe","controlledIssueKey":"SAFE-OPEN-1"}
JSON
valid_config="$work/config-valid.json"
cp "$config" "$valid_config"

findings="$work/findings.json"
printf '{"Findings":[]}' >"$findings"
import_ok="$work/import-ok.json"
printf '{"FailedFindings":[]}' >"$import_ok"
import_partial="$work/import-partial.json"
printf '{"FailedFindings":[{"Id":"crewsafe/sonarcloud/zctiong-iss_crewsafe/SAFE-OPEN-1","ErrorCode":"InvalidInputException"}]}' >"$import_partial"
empty="$work/empty.json"
printf '{"total":0,"issues":[]}' >"$empty"

run_import() {
  local response="$1" lifecycle_response="$2" import_response="$3" output="$4"
  : >"$work/calls.log"
  PATH="$mock_bin:$PATH" \
  CONFIG_FILE="$config" GITHUB_ACTIONS=true GITHUB_EVENT_NAME=push GITHUB_REF=refs/heads/main \
  GITHUB_SHA=0123456789012345678901234567890123456789 GITHUB_RUN_ID=unit-test \
  SONAR_SECURITYHUB_TOKEN=synthetic-test-token CREWSAFE_SECURITYHUB_ACCOUNT_ID=123456789012 \
  AWS_REGION=ap-southeast-1 MOCK_CALL_LOG="$work/calls.log" MOCK_CURL_RESPONSE_FILE="$response" \
  MOCK_CURL_LIFECYCLE_RESPONSE_FILE="$lifecycle_response" \
  MOCK_AWS_FINDINGS_RESPONSE_FILE="$findings" MOCK_AWS_IMPORT_RESPONSE_FILE="$import_response" \
  "$SCRIPT" >"$output" 2>&1
}

run_import_dispatch() {
  local response="$1" lifecycle_response="$2" import_response="$3" output="$4"
  : >"$work/calls.log"
  PATH="$mock_bin:$PATH" \
  CONFIG_FILE="$config" GITHUB_ACTIONS=true GITHUB_EVENT_NAME=workflow_dispatch GITHUB_REF=refs/heads/main \
  GITHUB_SHA=0123456789012345678901234567890123456789 GITHUB_RUN_ID=unit-test \
  SONAR_SECURITYHUB_TOKEN=synthetic-test-token CREWSAFE_SECURITYHUB_ACCOUNT_ID=123456789012 \
  AWS_REGION=ap-southeast-1 MOCK_CALL_LOG="$work/calls.log" MOCK_CURL_RESPONSE_FILE="$response" \
  MOCK_CURL_LIFECYCLE_RESPONSE_FILE="$lifecycle_response" \
  MOCK_AWS_FINDINGS_RESPONSE_FILE="$findings" MOCK_AWS_IMPORT_RESPONSE_FILE="$import_response" \
  "$SCRIPT" >"$output" 2>&1
}

valid="$work/valid.json"
jq '.valid' "$FIXTURES/active-cases.json" >"$valid"
invalid="$work/invalid.json"
jq '.invalid' "$FIXTURES/active-cases.json" >"$invalid"
invalid_impact="$work/invalid-impact.json"
jq '.invalidImpact' "$FIXTURES/active-cases.json" >"$invalid_impact"
resolved="$work/resolved.json"
jq '.resolved' "$FIXTURES/lifecycle-cases.json" >"$resolved"

out="$work/out.txt"
assert_exit 0 "valid selected finding imports" run_import "$valid" "$empty" "$import_ok" "$out"
summary="$(cat "$out")"
assert_contains "$summary" "IMPORTED" "success summary is text-labelled"
assert_contains "$summary" "crewsafe/sonarcloud/zctiong-iss_crewsafe/SAFE-OPEN-1" "stable ID is emitted"
assert_not_contains "$summary" "synthetic-test-token" "token is redacted"
assert_not_contains "$summary" "message" "raw Sonar text is excluded"
calls="$(cat "$work/calls.log")"
assert_contains "$calls" "securityhub batch-import-findings" "custom finding is submitted"
assert_contains "$calls" "impactSeverities=BLOCKER,HIGH" "active query uses software-quality severity filter"
assert_not_contains "$calls" "&severities=BLOCKER,HIGH" "active query does not use legacy type severity filter"
assert_contains "$calls" '"providerSeverity":"HIGH"' "MQR security impact maps to ASFF severity"
assert_contains "$calls" '"sonarSeverity":"HIGH"' "MQR security impact is retained as provider metadata"

assert_exit 0 "manual workflow dispatch imports selected finding" run_import_dispatch "$valid" "$empty" "$import_ok" "$out"
assert_contains "$(cat "$out")" "IMPORTED" "manual dispatch summary is text-labelled"

jq '.sonarHostUrl = "https://hostile.invalid"' "$valid_config" >"$config"
assert_exit 1 "hostile origin is denied before any network call" run_import "$valid" "$empty" "$import_ok" "$out"
assert_contains "$(cat "$out")" "CONFIG_ORIGIN_DENIED" "hostile origin has a safe reason"
[[ ! -s "$work/calls.log" ]] || _fail "hostile origin must not call curl or aws"
cp "$valid_config" "$config"

prefix_timestamp="$work/prefix-timestamp.json"
jq '.valid | .issues[0].creationDate = "prefix-2026-08-08T00:00:00Z"' "$FIXTURES/active-cases.json" >"$prefix_timestamp"
assert_exit 1 "timestamp prefix is rejected before import" run_import "$prefix_timestamp" "$empty" "$import_ok" "$out"
assert_not_contains "$(cat "$work/calls.log")" "securityhub batch-import-findings" "prefix timestamp is never imported"

suffix_timestamp="$work/suffix-timestamp.json"
jq '.valid | .issues[0].updateDate = "2026-08-08T00:01:00Z-suffix"' "$FIXTURES/active-cases.json" >"$suffix_timestamp"
assert_exit 1 "timestamp suffix is rejected before import" run_import "$suffix_timestamp" "$empty" "$import_ok" "$out"
assert_not_contains "$(cat "$work/calls.log")" "securityhub batch-import-findings" "suffix timestamp is never imported"

assert_exit 1 "invalid candidate fails closed" run_import "$invalid" "$empty" "$import_ok" "$out"
assert_not_contains "$(cat "$out")" "source.java" "unsafe source text is not echoed"

assert_exit 1 "ineligible MQR security impact fails closed" run_import "$invalid_impact" "$empty" "$import_ok" "$out"
assert_not_contains "$(cat "$work/calls.log")" "securityhub batch-import-findings" "ineligible MQR impact is never imported"

assert_exit 1 "partial batch is not success" run_import "$valid" "$empty" "$import_partial" "$out"
assert_contains "$(cat "$out")" "FAILED_PARTIAL" "partial failure is labelled"

findings_one="$work/findings-one.json"
printf '{"Findings":[{"Id":"crewsafe/sonarcloud/zctiong-iss_crewsafe/SAFE-OPEN-1","ProductArn":"arn:aws:securityhub:ap-southeast-1:123456789012:product/123456789012/default","UpdatedAt":"2026-08-08T00:00:30Z","RecordState":"ACTIVE"}]}' >"$findings_one"
findings="$findings_one"
assert_exit 0 "later source timestamp updates one stable finding" run_import "$valid" "$empty" "$import_ok" "$out"
assert_contains "$(cat "$out")" "UPDATED" "update is text-labelled"

assert_exit 0 "controlled resolved finding archives one import" run_import "$empty" "$resolved" "$import_ok" "$out"
assert_contains "$(cat "$out")" "ARCHIVED" "archive is text-labelled"

jq '.enabled = false' "$config" >"$work/inactive.json"
mv "$work/inactive.json" "$config"
: >"$work/calls.log"
inactive_output="$(PATH="$mock_bin:$PATH" CONFIG_FILE="$config" "$SCRIPT")"
assert_contains "$inactive_output" "NOT-ACTIVATED" "inactive configuration is visible"
[[ ! -s "$work/calls.log" ]] || _fail "inactive configuration must not call cloud dependencies"

finish
