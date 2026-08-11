#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/dast-staging.yml"
BACKEND_WORKFLOW="$ROOT/.github/workflows/backend-ci.yml"
WEB_WORKFLOW="$ROOT/.github/workflows/web-ci.yml"
VALIDATOR="$ROOT/.github/scripts/security/validate-dast-staging-contract.sh"
RUNNER="$ROOT/.github/scripts/security/run-authenticated-dast.sh"
AUTOMATION="$ROOT/.github/security/dast/automation.yaml"
METHOD_GUARD="$ROOT/.github/security/dast/active-scan-method-guard.js"
RUNBOOK="$ROOT/docs/runbooks/SCRUM-273-authenticated-staging-dast.md"
PLAN="$ROOT/docs/plans/SCRUM-273-authenticated-staging-dast-plan.md"
TESTS_RUN=0
TESTS_FAILED=0

pass() { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; TESTS_FAILED=$((TESTS_FAILED + 1)); }

file_exists() {
  local label="$1" path="$2"
  TESTS_RUN=$((TESTS_RUN + 1))
  [[ -f "$path" ]] && pass "$label" || fail "$label"
}

contains() {
  local label="$1" path="$2" needle="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  [[ -f "$path" ]] && rg -q -F -- "$needle" "$path" && pass "$label" || fail "$label"
}

not_contains() {
  local label="$1" path="$2" needle="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  { [[ ! -f "$path" ]] || ! rg -q -F -- "$needle" "$path"; } && pass "$label" || fail "$label"
}

script_rejects() {
  local label="$1"; shift
  TESTS_RUN=$((TESTS_RUN + 1))
  if "$@" >/dev/null 2>&1; then fail "$label"; else pass "$label"; fi
}

script_accepts() {
  local label="$1"; shift
  TESTS_RUN=$((TESTS_RUN + 1))
  if "$@" >/dev/null 2>&1; then pass "$label"; else fail "$label"; fi
}

file_exists "reusable DAST workflow exists" "$WORKFLOW"
file_exists "DAST validator exists" "$VALIDATOR"
file_exists "DAST runner exists" "$RUNNER"
file_exists "ZAP automation policy exists" "$AUTOMATION"
file_exists "active-scan method guard exists" "$METHOD_GUARD"
file_exists "DAST operating procedure exists" "$RUNBOOK"
file_exists "durable DAST plan exists" "$PLAN"
contains "validator uses portable grep checks" "$VALIDATOR" "grep -Fq"
not_contains "validator has no runtime ripgrep dependency" "$VALIDATOR" "rg -q"

contains "workflow is reusable" "$WORKFLOW" "workflow_call:"
contains "workflow is read-only" "$WORKFLOW" "contents: read"
not_contains "workflow has no AWS identity permission" "$WORKFLOW" "id-token: write"
not_contains "workflow never inherits every secret" "$WORKFLOW" "secrets: inherit"
not_contains "workflow does not upload raw artifacts" "$WORKFLOW" "upload-artifact"
not_contains "workflow does not create GitHub issues" "$WORKFLOW" "issues: write"
contains "workflow maps only DAST password" "$WORKFLOW" "DAST_SYNTHETIC_WORKER_PASSWORD"
contains "workflow requires web allowlist entry" "$WORKFLOW" "approved_web_base_url"
contains "workflow requires backend allowlist entry" "$WORKFLOW" "approved_backend_base_url"
contains "workflow runs preflight before scanner" "$WORKFLOW" "validate-dast-staging-contract.sh"
contains "workflow runs redacted scanner wrapper" "$WORKFLOW" "run-authenticated-dast.sh"
contains "runner uses an ephemeral runner directory" "$RUNNER" 'RUNNER_TEMP:-/tmp'
contains "runner cleans up ephemeral scan data" "$RUNNER" "trap cleanup EXIT INT TERM"
contains "runner disables ZAP telemetry" "$RUNNER" "-notel"
not_contains "runner never uploads raw scanner artifacts" "$RUNNER" "upload-artifact"

contains "backend caller depends on deployment" "$BACKEND_WORKFLOW" "needs: deploy-staging"
contains "backend caller invokes reusable DAST workflow" "$BACKEND_WORKFLOW" "uses: ./.github/workflows/dast-staging.yml"
contains "backend caller identifies backend trigger" "$BACKEND_WORKFLOW" "trigger_component: backend"
contains "web caller depends on deployment" "$WEB_WORKFLOW" "needs: deploy-staging"
contains "web caller invokes reusable DAST workflow" "$WEB_WORKFLOW" "uses: ./.github/workflows/dast-staging.yml"
contains "web caller identifies web trigger" "$WEB_WORKFLOW" "trigger_component: web"

contains "automation uses browser authentication" "$AUTOMATION" "method: browser"
contains "automation supplies browser login URL" "$AUTOMATION" 'loginPageUrl: ${WEB_BASE_URL}'
contains "automation disables browser authentication diagnostics" "$AUTOMATION" "diagnostics: false"
contains "automation includes web target" "$AUTOMATION" '${WEB_BASE_URL}'
contains "automation includes backend target" "$AUTOMATION" '${BACKEND_BASE_URL}'
contains "automation loads method guard" "$AUTOMATION" "active-scan-method-guard.js"
contains "automation leaves query injection disabled" "$AUTOMATION" "addQueryParam: false"
not_contains "automation uses removed active-scan input-vector schema" "$AUTOMATION" "inputVectors:"
contains "automation bounds active scan duration" "$AUTOMATION" "maxScanDurationInMins: 15"
contains "method guard checks active-scanner initiator" "$METHOD_GUARD" "HttpSender.ACTIVE_SCANNER_INITIATOR"
contains "method guard allows GET" "$METHOD_GUARD" "GET"
contains "method guard allows HEAD" "$METHOD_GUARD" "HEAD"
contains "method guard rejects unsafe active requests" "$METHOD_GUARD" "throw"

contains "runbook explains advisory status" "$RUNBOOK" "advisory"
contains "runbook names SCRUM-297 handoff" "$RUNBOOK" "SCRUM-297"
contains "runbook forbids secrets in evidence" "$RUNBOOK" "Never record"
contains "runbook includes recovery path" "$RUNBOOK" "Recovery"
contains "durable plan states constitution compliance" "$PLAN" "Constitution compliance"

if [[ -x "$VALIDATOR" ]]; then
  script_accepts "validator accepts reviewed contract" env \
    TRIGGER_COMPONENT=backend TRIGGER_SHA=0123456789012345678901234567890123456789 \
    WEB_BASE_URL=https://d3b75ru76gta2n.cloudfront.net BACKEND_BASE_URL=https://d9a1b2c3d4e5f.cloudfront.net \
    APPROVED_WEB_BASE_URL=https://d3b75ru76gta2n.cloudfront.net APPROVED_BACKEND_BASE_URL=https://d9a1b2c3d4e5f.cloudfront.net \
    HOSTED_UI_URL=https://crewsafe.auth.ap-southeast-1.amazoncognito.com \
    DAST_USERNAME=worker.bishan@synthetic.crewsafe.invalid DAST_SYNTHETIC_WORKER_PASSWORD=synthetic-password \
    ZAP_IMAGE=ghcr.io/zaproxy/zaproxy@sha256:71db37cd5b75663b35758d10aaec05bf6fbac23f5020e3046c70e628a5f84efa \
    DAST_POLICY_PATH="$AUTOMATION" "$VALIDATOR"
  script_rejects "validator rejects non-HTTPS target without leaking password" env \
    TRIGGER_COMPONENT=backend TRIGGER_SHA=0123456789012345678901234567890123456789 \
    WEB_BASE_URL=http://example.invalid BACKEND_BASE_URL=https://d3b75ru76gta2n.cloudfront.net \
    APPROVED_WEB_BASE_URL=http://example.invalid APPROVED_BACKEND_BASE_URL=https://d3b75ru76gta2n.cloudfront.net \
    HOSTED_UI_URL=https://example.auth.ap-southeast-1.amazoncognito.com \
    DAST_USERNAME=worker.bishan@synthetic.crewsafe.invalid DAST_SYNTHETIC_WORKER_PASSWORD=synthetic-password \
    ZAP_IMAGE=ghcr.io/zaproxy/zaproxy@sha256:71db37cd5b75663b35758d10aaec05bf6fbac23f5020e3046c70e628a5f84efa \
    "$VALIDATOR"
  script_rejects "validator rejects an IP-address target" env \
    TRIGGER_COMPONENT=web TRIGGER_SHA=0123456789012345678901234567890123456789 \
    WEB_BASE_URL=https://127.0.0.1 BACKEND_BASE_URL=https://d9a1b2c3d4e5f.cloudfront.net \
    APPROVED_WEB_BASE_URL=https://127.0.0.1 APPROVED_BACKEND_BASE_URL=https://d9a1b2c3d4e5f.cloudfront.net \
    HOSTED_UI_URL=https://crewsafe.auth.ap-southeast-1.amazoncognito.com \
    DAST_USERNAME=worker.bishan@synthetic.crewsafe.invalid DAST_SYNTHETIC_WORKER_PASSWORD=synthetic-password \
    ZAP_IMAGE=ghcr.io/zaproxy/zaproxy@sha256:71db37cd5b75663b35758d10aaec05bf6fbac23f5020e3046c70e628a5f84efa \
    "$VALIDATOR"
  script_rejects "validator rejects a query-bearing target" env \
    TRIGGER_COMPONENT=web TRIGGER_SHA=0123456789012345678901234567890123456789 \
    WEB_BASE_URL='https://d3b75ru76gta2n.cloudfront.net/?token=synthetic' BACKEND_BASE_URL=https://d9a1b2c3d4e5f.cloudfront.net \
    APPROVED_WEB_BASE_URL='https://d3b75ru76gta2n.cloudfront.net/?token=synthetic' APPROVED_BACKEND_BASE_URL=https://d9a1b2c3d4e5f.cloudfront.net \
    HOSTED_UI_URL=https://crewsafe.auth.ap-southeast-1.amazoncognito.com \
    DAST_USERNAME=worker.bishan@synthetic.crewsafe.invalid DAST_SYNTHETIC_WORKER_PASSWORD=synthetic-password \
    ZAP_IMAGE=ghcr.io/zaproxy/zaproxy@sha256:71db37cd5b75663b35758d10aaec05bf6fbac23f5020e3046c70e628a5f84efa \
    "$VALIDATOR"
  script_rejects "validator rejects an unapproved target" env \
    TRIGGER_COMPONENT=web TRIGGER_SHA=0123456789012345678901234567890123456789 \
    WEB_BASE_URL=https://unapproved.cloudfront.net BACKEND_BASE_URL=https://d9a1b2c3d4e5f.cloudfront.net \
    APPROVED_WEB_BASE_URL=https://d3b75ru76gta2n.cloudfront.net APPROVED_BACKEND_BASE_URL=https://d9a1b2c3d4e5f.cloudfront.net \
    HOSTED_UI_URL=https://crewsafe.auth.ap-southeast-1.amazoncognito.com \
    DAST_USERNAME=worker.bishan@synthetic.crewsafe.invalid DAST_SYNTHETIC_WORKER_PASSWORD=synthetic-password \
    ZAP_IMAGE=ghcr.io/zaproxy/zaproxy@sha256:71db37cd5b75663b35758d10aaec05bf6fbac23f5020e3046c70e628a5f84efa \
    "$VALIDATOR"
else
  TESTS_RUN=$((TESTS_RUN + 1)); fail "validator is executable"
fi

printf '\n%d run, %d failed\n' "$TESTS_RUN" "$TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]
