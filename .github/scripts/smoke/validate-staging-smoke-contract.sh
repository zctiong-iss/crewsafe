#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'Staging smoke configuration rejected: %s\n' "$1" >&2
  exit 1
}

require_value() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "missing ${name}"
}

for required in TRIGGER_COMPONENT TRIGGER_SHA WEB_BASE_URL BACKEND_BASE_URL \
  APPROVED_WEB_BASE_URL APPROVED_BACKEND_BASE_URL SMOKE_SITE_ID SMOKE_USERNAME \
  COGNITO_CONFIG_JSON SMOKE_SYNTHETIC_WORKER_PASSWORD; do
  require_value "$required"
done

[[ "$TRIGGER_COMPONENT" == backend || "$TRIGGER_COMPONENT" == web ]] \
  || fail 'component is not backend or web'
[[ "$TRIGGER_SHA" =~ ^[0-9a-f]{40}$ ]] || fail 'deployed revision is malformed'

valid_origin='^https://[a-z0-9]+\.cloudfront\.net$'
for origin_name in WEB_BASE_URL BACKEND_BASE_URL APPROVED_WEB_BASE_URL APPROVED_BACKEND_BASE_URL; do
  origin="${!origin_name}"
  [[ "$origin" =~ $valid_origin ]] || fail "${origin_name} is not an approved HTTPS origin"
  [[ "$origin" != *prod* && "$origin" != *production* ]] || fail "${origin_name} looks like a production target"
done

[[ "$WEB_BASE_URL" == "$APPROVED_WEB_BASE_URL" ]] \
  || fail 'web origin is outside the approved allowlist'
[[ "$BACKEND_BASE_URL" == "$APPROVED_BACKEND_BASE_URL" ]] \
  || fail 'backend origin is outside the approved allowlist'
[[ "$WEB_BASE_URL" != "$BACKEND_BASE_URL" ]] \
  || fail 'web and backend origins must be distinct'
[[ "$SMOKE_SITE_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] \
  || fail 'smoke site ID is malformed'
[[ "$SMOKE_USERNAME" =~ ^[a-z0-9._-]+@synthetic\.crewsafe\.invalid$ ]] \
  || fail 'identity is not an approved synthetic username'

if ! jq -e \
  '(.accounts.dev.user_pool_id | type == "string" and length > 0) and
   (.accounts.dev.region == "ap-southeast-1") and
   (.accounts.dev.cli_client_id | type == "string" and length > 0)' \
  <<<"$COGNITO_CONFIG_JSON" >/dev/null 2>&1; then
  fail 'shared Cognito configuration is malformed or not the Singapore dev profile'
fi

exit 0
