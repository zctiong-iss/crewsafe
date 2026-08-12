#!/usr/bin/env bash
set -euo pipefail

GITHUB_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SMOKE_WORKFLOW="$GITHUB_DIR/workflows/staging-smoke.yml"
BACKEND_WORKFLOW="$GITHUB_DIR/workflows/backend-ci.yml"
WEB_WORKFLOW="$GITHUB_DIR/workflows/web-ci.yml"
VALIDATOR="$GITHUB_DIR/scripts/smoke/validate-staging-smoke-contract.sh"
RUNNER="$GITHUB_DIR/scripts/smoke/run-staging-smoke.sh"
DEPLOY_SCRIPT="$GITHUB_DIR/scripts/deploy/deploy-backend-staging.sh"
RUNBOOK="$ROOT/docs/runbooks/SCRUM-272-staging-smoke-tests.md"

TEST_TMP="$(mktemp -d)"
STUB_BIN="$TEST_TMP/bin"
STUB_STATE="$TEST_TMP/state"
mkdir -p "$STUB_BIN" "$STUB_STATE"
ORIGINAL_PATH="$PATH"
TESTS_RUN=0
TESTS_FAILED=0

REVISION=0123456789abcdef0123456789abcdef01234567
SITE_ID=11111111-1111-4111-8111-111111111111
OTHER_SITE_ID=22222222-2222-4222-8222-222222222222
WEB_ORIGIN=https://d3b75ru76gta2n.cloudfront.net
BACKEND_ORIGIN=https://d9a1b2c3d4e5f.cloudfront.net
SMOKE_USERNAME="worker.smoke-$$@synthetic.crewsafe.invalid"
SMOKE_PASSWORD="pw-$$-$(date +%s)"
ACCESS_TOKEN="access-$$-token"
COOKIE_VALUE="cookie-$$"
CONFIG_JSON='{"accounts":{"dev":{"user_pool_id":"ap-southeast-1_example","region":"ap-southeast-1","cli_client_id":"examplecli123"}}}'
CALL_LOG="$TEST_TMP/calls.log"

cleanup() { rm -rf "$TEST_TMP"; }
trap cleanup EXIT INT TERM

pass() { printf '  ok   %s\n' "$1"; }
fail() {
  printf '  FAIL %s\n' "$1"
  [[ $# -gt 1 ]] && printf '       %s\n' "$2"
  TESTS_FAILED=$((TESTS_FAILED + 1))
}

assert_file() {
  local label="$1" path="$2"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ -f "$path" ]]; then pass "$label"; else fail "$label" "missing file"; fi
}

assert_executable() {
  local label="$1" path="$2"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ -x "$path" ]]; then pass "$label"; else fail "$label" "missing executable"; fi
}

assert_contains() {
  local label="$1" path="$2" needle="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ -f "$path" ]] && grep -Fq -- "$needle" "$path"; then pass "$label"; else fail "$label"; fi
}

assert_not_contains() {
  local label="$1" path="$2" needle="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ -f "$path" ]] && ! grep -Fq -- "$needle" "$path"; then pass "$label"; else fail "$label"; fi
}

assert_regex() {
  local label="$1" path="$2" expression="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ -f "$path" ]] && grep -Eq -- "$expression" "$path"; then pass "$label"; else fail "$label"; fi
}

assert_not_in_dir() {
  local label="$1" dir="$2" needle="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if ! grep -R -F -- "$needle" "$dir" >/dev/null 2>&1; then pass "$label"; else fail "$label" "sensitive value was present (value withheld)"; fi
}

reset_stubs() {
  : >"$CALL_LOG"
  rm -f "$STUB_STATE"/*
}

cat >"$STUB_BIN/aws" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${SMOKE_STUB_MODE:-healthy}" == aws-failure ]]; then exit 7; fi
printf '{"AuthenticationResult":{"AccessToken":"%s","ExpiresIn":3600}}\n' "$SMOKE_ACCESS_TOKEN"
EOF

cat >"$STUB_BIN/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
out_file=''
url=''
method=GET
write_format=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) out_file="$2"; shift 2 ;;
    -w) write_format="$2"; shift 2 ;;
    -X) method="$2"; shift 2 ;;
    -H|--header|--max-time|--connect-timeout) shift 2 ;;
    --silent|--show-error|--fail) shift ;;
    --*) shift ;;
    *) url="$1"; shift ;;
  esac
done

printf '%s\t%s\n' "$method" "$url" >>"$SMOKE_CALL_LOG"
if [[ "${SMOKE_STUB_MODE:-healthy}" == timeout || "${SMOKE_STUB_MODE:-healthy}" == transport ]]; then exit 28; fi

key="$(printf '%s' "$url" | tr '/:?&=' '_')"
attempt_file="$SMOKE_STUB_STATE/$key"
attempt=0
if [[ -f "$attempt_file" ]]; then attempt="$(cat "$attempt_file")"; fi
attempt=$((attempt + 1))
printf '%s' "$attempt" >"$attempt_file"

status=200
body='{}'
case "$url" in
  */actuator/health/liveness|*/actuator/health/readiness)
    body='{"status":"UP"}'
    ;;
  */api/v1/me)
    case "${SMOKE_STUB_MODE:-healthy}" in
      unauthorized) status=401; body='{"error":"Unauthorized","message":"Authentication failed"}' ;;
      redirect) status=302; body='{"location":"https://unexpected.invalid"}' ;;
      malformed) body='{"role":"WORKER"}' ;;
      raw-sensitive) status=500; body="{\"error\":\"$SMOKE_PASSWORD $SMOKE_ACCESS_TOKEN $SMOKE_COOKIE\"}" ;;
      retry-5xx)
        if [[ "$attempt" == 1 ]]; then status=503; body='{"error":"temporary"}'; else body="{\"id\":\"worker-1\",\"username\":\"$SMOKE_USERNAME\",\"displayName\":\"Smoke Worker\",\"role\":\"WORKER\",\"siteIds\":[\"$SMOKE_SITE_ID\"]}"; fi
        ;;
      *) body="{\"id\":\"worker-1\",\"username\":\"$SMOKE_USERNAME\",\"displayName\":\"Smoke Worker\",\"role\":\"WORKER\",\"siteIds\":[\"$SMOKE_SITE_ID\"]}" ;;
    esac
    ;;
  */api/v1/shifts/me)
    if [[ "${SMOKE_STUB_MODE:-healthy}" == critical-failure ]]; then
      status=500; body='{"error":"temporary"}'
    elif [[ "${SMOKE_STUB_MODE:-healthy}" == missing-shift ]]; then
      body='{"shift":null}'
    else
      body='{"shift":{"shiftId":"33333333-3333-4333-8333-333333333333","assignment":{"taskName":"Outdoor inspection"},"latestReadiness":null}}'
    fi
    ;;
  */api/v1/sites/*/weather/latest)
    weather_site="$SMOKE_SITE_ID"
    [[ "${SMOKE_STUB_MODE:-healthy}" == wrong-site ]] && weather_site="$OTHER_SITE_ID"
    body="{\"id\":\"44444444-4444-4444-8444-444444444444\",\"siteId\":\"$weather_site\",\"wbgt\":28.4,\"temperature\":32.1,\"humidity\":72.0,\"windSpeed\":2.1,\"rainfall\":0.0,\"observedAt\":\"2026-08-12T08:00:00Z\",\"qualityStatus\":\"VALID\",\"band\":\"LOW\"}"
    ;;
  */)
    if [[ "$url" == "${WEB_BASE_URL}/" ]]; then
      body='<!doctype html><html><head><title>CrewSafe</title></head><body>Smoke</body></html>'
      [[ "${SMOKE_STUB_MODE:-healthy}" == web-bad ]] && body='not html'
    fi
    ;;
esac

if [[ "${SMOKE_STUB_MODE:-healthy}" == retry-5xx && "$attempt" == 1 && "$status" == 200 ]]; then status=503; fi
if [[ -n "$out_file" ]]; then printf '%s' "$body" >"$out_file"; fi
if [[ "$write_format" == '%{http_code}' ]]; then printf '%s' "$status"; fi
EOF

chmod +x "$STUB_BIN/aws" "$STUB_BIN/curl"

COMMON_ENV=(
  "PATH=$STUB_BIN:$ORIGINAL_PATH"
  "TRIGGER_COMPONENT=backend"
  "TRIGGER_SHA=$REVISION"
  "WEB_BASE_URL=$WEB_ORIGIN"
  "BACKEND_BASE_URL=$BACKEND_ORIGIN"
  "APPROVED_WEB_BASE_URL=$WEB_ORIGIN"
  "APPROVED_BACKEND_BASE_URL=$BACKEND_ORIGIN"
  "SMOKE_SITE_ID=$SITE_ID"
  "SMOKE_USERNAME=$SMOKE_USERNAME"
  "SMOKE_SYNTHETIC_WORKER_PASSWORD=$SMOKE_PASSWORD"
  "COGNITO_CONFIG_JSON=$CONFIG_JSON"
  "SMOKE_ACCESS_TOKEN=$ACCESS_TOKEN"
  "SMOKE_COOKIE=$COOKIE_VALUE"
  "SMOKE_STUB_STATE=$STUB_STATE"
  "SMOKE_CALL_LOG=$CALL_LOG"
  "DEPLOYMENT_RUN_URL=https://github.com/example/crewsafe/actions/runs/1001"
  "SMOKE_RUN_URL=https://github.com/example/crewsafe/actions/runs/1002"
  "RUNBOOK_PATH=docs/runbooks/SCRUM-272-staging-smoke-tests.md"
)

run_validator_capture() {
  local name="$1"; shift
  VALIDATOR_OUT="$TEST_TMP/${name}.out"
  VALIDATOR_ERR="$TEST_TMP/${name}.err"
  set +e
  env "${COMMON_ENV[@]}" "$@" "$VALIDATOR" >"$VALIDATOR_OUT" 2>"$VALIDATOR_ERR"
  VALIDATOR_STATUS=$?
  set -e
}

run_runner_capture() {
  local name="$1"; shift
  reset_stubs
  EVIDENCE="$TEST_TMP/${name}.json"
  SUMMARY="$TEST_TMP/${name}.summary"
  RUNNER_OUT="$TEST_TMP/${name}.out"
  RUNNER_ERR="$TEST_TMP/${name}.err"
  set +e
  env "${COMMON_ENV[@]}" \
    "SMOKE_EVIDENCE_FILE=$EVIDENCE" \
    "GITHUB_STEP_SUMMARY=$SUMMARY" \
    "$@" "$RUNNER" >"$RUNNER_OUT" 2>"$RUNNER_ERR"
  RUNNER_STATUS=$?
  set -e
}

printf '%s\n' 'Staging smoke tests'

# T003: structural workflow and release-boundary guards.
assert_file "reusable smoke workflow exists" "$SMOKE_WORKFLOW"
assert_contains "smoke workflow is reusable" "$SMOKE_WORKFLOW" 'workflow_call:'
assert_contains "smoke workflow is read-only" "$SMOKE_WORKFLOW" 'contents: read'
assert_not_contains "smoke workflow has no OIDC permission" "$SMOKE_WORKFLOW" 'id-token: write'
assert_not_contains "smoke workflow does not inherit secrets" "$SMOKE_WORKFLOW" 'secrets: inherit'
assert_contains "smoke workflow has five-minute timeout" "$SMOKE_WORKFLOW" 'timeout-minutes: 5'
assert_regex "smoke workflow pins checkout action" "$SMOKE_WORKFLOW" 'actions/checkout@[0-9a-f]{40}'
assert_regex "smoke workflow pins artifact action" "$SMOKE_WORKFLOW" 'actions/upload-artifact@[0-9a-f]{40}'
assert_contains "backend smoke caller depends on deployment" "$BACKEND_WORKFLOW" 'needs: deploy-staging'
assert_contains "backend smoke caller checks deployment success" "$BACKEND_WORKFLOW" "needs.deploy-staging.result == 'success'"
assert_contains "backend deploy exposes deployed revision" "$BACKEND_WORKFLOW" 'deployed_revision:'
assert_contains "backend smoke passes deployment output" "$BACKEND_WORKFLOW" 'needs.deploy-staging.outputs.deployed_revision'
assert_contains "web smoke caller depends on deployment" "$WEB_WORKFLOW" 'needs: deploy-staging'
assert_contains "web smoke caller checks deployment success" "$WEB_WORKFLOW" "needs.deploy-staging.result == 'success'"
assert_contains "web deploy exposes deployed revision" "$WEB_WORKFLOW" 'deployed_revision:'
assert_contains "web smoke passes deployment output" "$WEB_WORKFLOW" 'needs.deploy-staging.outputs.deployed_revision'
assert_contains "backend deploy script emits revision" "$DEPLOY_SCRIPT" 'deployed_revision=$IMAGE_TAG'
assert_not_contains "backend smoke caller does not inherit secrets" "$BACKEND_WORKFLOW" 'secrets: inherit'
assert_not_contains "web smoke caller does not inherit secrets" "$WEB_WORKFLOW" 'secrets: inherit'

# T004: validator contract tests. Runtime cases are skipped as a group when the
# implementation is absent, so a missing executable cannot make negative cases pass.
assert_executable "staging smoke validator is executable" "$VALIDATOR"
if [[ -x "$VALIDATOR" ]]; then
  run_validator_capture valid
  TESTS_RUN=$((TESTS_RUN + 1)); [[ "$VALIDATOR_STATUS" == 0 ]] && pass "validator accepts reviewed configuration" || fail "validator accepts reviewed configuration"
  assert_not_in_dir "valid validator output excludes password" "$TEST_TMP" "$SMOKE_PASSWORD"

  run_validator_capture valid-web TRIGGER_COMPONENT=web
  TESTS_RUN=$((TESTS_RUN + 1)); [[ "$VALIDATOR_STATUS" == 0 ]] && pass "validator accepts web configuration" || fail "validator accepts web configuration"

  run_validator_capture bad-origin WEB_BASE_URL=http://example.invalid APPROVED_WEB_BASE_URL=http://example.invalid
  TESTS_RUN=$((TESTS_RUN + 1)); [[ "$VALIDATOR_STATUS" != 0 ]] && pass "validator rejects non-HTTPS origin" || fail "validator rejects non-HTTPS origin"
  assert_not_in_dir "bad-origin output excludes password" "$TEST_TMP" "$SMOKE_PASSWORD"

  run_validator_capture bad-query WEB_BASE_URL="$WEB_ORIGIN/?token=unsafe" APPROVED_WEB_BASE_URL="$WEB_ORIGIN/?token=unsafe"
  TESTS_RUN=$((TESTS_RUN + 1)); [[ "$VALIDATOR_STATUS" != 0 ]] && pass "validator rejects query-bearing origin" || fail "validator rejects query-bearing origin"

  run_validator_capture bad-host WEB_BASE_URL=https://unapproved.cloudfront.net
  TESTS_RUN=$((TESTS_RUN + 1)); [[ "$VALIDATOR_STATUS" != 0 ]] && pass "validator rejects unapproved origin" || fail "validator rejects unapproved origin"

  run_validator_capture bad-production WEB_BASE_URL=https://production.cloudfront.net APPROVED_WEB_BASE_URL=https://production.cloudfront.net
  TESTS_RUN=$((TESTS_RUN + 1)); [[ "$VALIDATOR_STATUS" != 0 ]] && pass "validator rejects production-looking origin" || fail "validator rejects production-looking origin"

  run_validator_capture bad-revision TRIGGER_SHA=not-a-sha
  TESTS_RUN=$((TESTS_RUN + 1)); [[ "$VALIDATOR_STATUS" != 0 ]] && pass "validator rejects malformed revision" || fail "validator rejects malformed revision"

  run_validator_capture missing-secret SMOKE_SYNTHETIC_WORKER_PASSWORD=
  TESTS_RUN=$((TESTS_RUN + 1)); [[ "$VALIDATOR_STATUS" != 0 ]] && pass "validator rejects missing password" || fail "validator rejects missing password"
  assert_not_in_dir "missing-secret output excludes password" "$TEST_TMP" "$SMOKE_PASSWORD"
else
  TESTS_RUN=$((TESTS_RUN + 1)); fail "validator contract tests skipped because validator is missing"
fi

# T005/T006: verifier runtime and read-only method tests.
assert_executable "staging smoke runner is executable" "$RUNNER"
if [[ -x "$RUNNER" ]]; then
  run_runner_capture healthy
  TESTS_RUN=$((TESTS_RUN + 1)); [[ "$RUNNER_STATUS" == 0 ]] && pass "healthy smoke run passes" || fail "healthy smoke run passes"
  assert_file "healthy evidence exists" "$EVIDENCE"
  assert_file "healthy summary exists" "$SUMMARY"
  if [[ -f "$EVIDENCE" ]]; then
    TESTS_RUN=$((TESTS_RUN + 1))
    if jq -e --arg rev "$REVISION" \
      '.schema_version == 1 and .revision == $rev and .component == "backend" and .overall_result == "passed" and (.target_hosts | length == 2) and ((.checks | map(.name)) == ["deployment_surface","service_readiness","authenticated_access","critical_workflow"]) and (.checks | all(.result == "passed" and (.attempts == 1 or .attempts == 2))) and ((.checks | map(.http_status)) | all(. == 200)) and .runbook_path == "docs/runbooks/SCRUM-272-staging-smoke-tests.md"' "$EVIDENCE" >/dev/null; then
      pass "healthy evidence has the required safe shape"
    else
      fail "healthy evidence has the required safe shape"
    fi
  fi
  if [[ -f "$CALL_LOG" ]]; then
    TESTS_RUN=$((TESTS_RUN + 1))
    expected_calls=$'GET\thttps://d9a1b2c3d4e5f.cloudfront.net/actuator/health/liveness\nGET\thttps://d9a1b2c3d4e5f.cloudfront.net/actuator/health/readiness\nGET\thttps://d9a1b2c3d4e5f.cloudfront.net/api/v1/me\nGET\thttps://d9a1b2c3d4e5f.cloudfront.net/api/v1/shifts/me\nGET\thttps://d9a1b2c3d4e5f.cloudfront.net/api/v1/sites/11111111-1111-4111-8111-111111111111/weather/latest'
    actual_calls="$(cat "$CALL_LOG")"
    if [[ "$actual_calls" == "$expected_calls" ]]; then pass "healthy checks run in order with GET only"; else fail "healthy checks run in order with GET only"; fi
  fi

  run_runner_capture web-healthy TRIGGER_COMPONENT=web
  TESTS_RUN=$((TESTS_RUN + 1)); [[ "$RUNNER_STATUS" == 0 ]] && pass "healthy web smoke run passes" || fail "healthy web smoke run passes"
  if [[ -f "$EVIDENCE" ]]; then
    TESTS_RUN=$((TESTS_RUN + 1))
    if jq -e '.component == "web" and .overall_result == "passed" and .checks[0].name == "deployment_surface" and .checks[0].http_status == 200' "$EVIDENCE" >/dev/null; then
      pass "web evidence records the web deployment surface"
    else
      fail "web evidence records the web deployment surface"
    fi
  fi

  run_runner_capture unauthorized SMOKE_STUB_MODE=unauthorized
  TESTS_RUN=$((TESTS_RUN + 1)); [[ "$RUNNER_STATUS" != 0 ]] && pass "unauthorized response fails smoke run" || fail "unauthorized response fails smoke run"
  run_runner_capture redirect SMOKE_STUB_MODE=redirect
  TESTS_RUN=$((TESTS_RUN + 1)); [[ "$RUNNER_STATUS" != 0 ]] && pass "redirect response fails smoke run" || fail "redirect response fails smoke run"
  run_runner_capture malformed SMOKE_STUB_MODE=malformed
  TESTS_RUN=$((TESTS_RUN + 1)); [[ "$RUNNER_STATUS" != 0 ]] && pass "malformed response fails smoke run" || fail "malformed response fails smoke run"
  run_runner_capture timeout SMOKE_STUB_MODE=timeout
  TESTS_RUN=$((TESTS_RUN + 1)); [[ "$RUNNER_STATUS" != 0 ]] && pass "timeout fails smoke run" || fail "timeout fails smoke run"
  run_runner_capture critical SMOKE_STUB_MODE=critical-failure
  TESTS_RUN=$((TESTS_RUN + 1)); [[ "$RUNNER_STATUS" != 0 ]] && pass "critical workflow failure fails smoke run" || fail "critical workflow failure fails smoke run"
  run_runner_capture retry SMOKE_STUB_MODE=retry-5xx
  TESTS_RUN=$((TESTS_RUN + 1)); [[ "$RUNNER_STATUS" == 0 ]] && pass "one transient 5xx retry can recover" || fail "one transient 5xx retry can recover"
  run_runner_capture raw-sensitive SMOKE_STUB_MODE=raw-sensitive
  TESTS_RUN=$((TESTS_RUN + 1)); [[ "$RUNNER_STATUS" != 0 ]] && pass "sensitive upstream failure fails smoke run" || fail "sensitive upstream failure fails smoke run"
  assert_not_in_dir "runner output excludes password" "$TEST_TMP" "$SMOKE_PASSWORD"
  assert_not_in_dir "runner output excludes access token" "$TEST_TMP" "$ACCESS_TOKEN"
  assert_not_in_dir "runner output excludes cookie" "$TEST_TMP" "$COOKIE_VALUE"
else
  TESTS_RUN=$((TESTS_RUN + 1)); fail "runtime tests skipped because runner is missing"
fi

# T013/T014/T017: evidence, artifact, and runbook contract guards.
if [[ -f "$SMOKE_WORKFLOW" ]]; then
  assert_contains "workflow always attempts evidence upload" "$SMOKE_WORKFLOW" 'if: always()'
  assert_contains "workflow shortens evidence retention" "$SMOKE_WORKFLOW" 'retention-days: 7'
  assert_not_contains "workflow does not continue after smoke failure" "$SMOKE_WORKFLOW" 'continue-on-error: true'
  assert_contains "verifier writes the GitHub step summary" "$RUNNER" 'GITHUB_STEP_SUMMARY'
fi
assert_file "SCRUM-272 runbook exists" "$RUNBOOK"
if [[ -f "$RUNBOOK" ]]; then
  assert_contains "runbook names triage owner" "$RUNBOOK" 'First triage owner'
  assert_contains "runbook documents rollback" "$RUNBOOK" 'Rollback'
  assert_contains "runbook documents escalation" "$RUNBOOK" 'Escalation'
  assert_contains "runbook documents recovery verification" "$RUNBOOK" 'Recovery verification'
  assert_contains "runbook forbids secrets" "$RUNBOOK" 'Do not record passwords'
  assert_not_contains "runbook has no secret-shaped bearer example" "$RUNBOOK" 'Bearer ey'
fi

printf '\n%d run, %d failed\n' "$TESTS_RUN" "$TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]
