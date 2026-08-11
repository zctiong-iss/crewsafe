#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

require_value() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "Missing required DAST configuration: $name"
}

for required in TRIGGER_COMPONENT TRIGGER_SHA WEB_BASE_URL BACKEND_BASE_URL \
  APPROVED_WEB_BASE_URL APPROVED_BACKEND_BASE_URL HOSTED_UI_URL DAST_USERNAME \
  DAST_SYNTHETIC_WORKER_PASSWORD ZAP_IMAGE; do
  require_value "$required"
done

[[ "$TRIGGER_COMPONENT" == backend || "$TRIGGER_COMPONENT" == web ]] \
  || fail "DAST trigger component is not approved"
[[ "$TRIGGER_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "DAST trigger SHA is malformed"

valid_cloudfront_origin='^https://[a-z0-9]+\.cloudfront\.net$'
[[ "$WEB_BASE_URL" =~ $valid_cloudfront_origin ]] || fail "DAST web target is not an approved HTTPS CloudFront origin"
[[ "$BACKEND_BASE_URL" =~ $valid_cloudfront_origin ]] || fail "DAST backend target is not an approved HTTPS CloudFront origin"
[[ "$WEB_BASE_URL" == "$APPROVED_WEB_BASE_URL" ]] || fail "DAST web target is outside the approved allowlist"
[[ "$BACKEND_BASE_URL" == "$APPROVED_BACKEND_BASE_URL" ]] || fail "DAST backend target is outside the approved allowlist"
[[ "$WEB_BASE_URL" != "$BACKEND_BASE_URL" ]] || fail "DAST scan targets must be distinct"
[[ "$HOSTED_UI_URL" =~ ^https://[a-z0-9-]+\.auth\.ap-southeast-1\.amazoncognito\.com$ ]] \
  || fail "DAST Hosted UI URL is malformed"
[[ "$DAST_USERNAME" =~ ^[a-z0-9._-]+@synthetic\.crewsafe\.invalid$ ]] \
  || fail "DAST identity is not an approved synthetic identity"
[[ "$ZAP_IMAGE" =~ ^ghcr\.io/zaproxy/zaproxy@sha256:[0-9a-f]{64}$ ]] \
  || fail "DAST scanner image must be pinned by immutable digest"

policy_path="${DAST_POLICY_PATH:-.github/security/dast/automation.yaml}"
[[ -r "$policy_path" ]] || fail "DAST automation policy is unavailable"
rg -q -F 'method: browser' "$policy_path" || fail "DAST policy does not require browser authentication"
rg -q -F 'active-scan-method-guard.js' "$policy_path" || fail "DAST policy does not load the method guard"
rg -q -F 'maxScanDurationInMins: 15' "$policy_path" || fail "DAST policy does not enforce scan duration"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "web_host=${WEB_BASE_URL#https://}"
    echo "backend_host=${BACKEND_BASE_URL#https://}"
    echo "hosted_ui_host=${HOSTED_UI_URL#https://}"
  } >>"$GITHUB_OUTPUT"
fi
