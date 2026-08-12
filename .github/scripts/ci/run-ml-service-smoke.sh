#!/usr/bin/env bash
# Start a local ML-service image without cloud credentials and validate only the
# deterministic health and forecast contracts.
set -euo pipefail

fail() {
  printf 'ERROR: ML-service smoke: %s\n' "$1" >&2
  exit 1
}

[[ $# -eq 1 ]] || fail "usage: run-ml-service-smoke.sh <local-image>"
IMAGE="$1"
RETRIES="${SMOKE_RETRIES:-20}"
RETRY_DELAY="${SMOKE_RETRY_DELAY:-1}"
[[ "$RETRIES" =~ ^[1-9][0-9]*$ ]] || fail "SMOKE_RETRIES must be a positive integer"
[[ "$RETRY_DELAY" =~ ^[0-9]+$ ]] || fail "SMOKE_RETRY_DELAY must be a non-negative integer"
command -v docker >/dev/null 2>&1 || fail "docker is required"
command -v curl >/dev/null 2>&1 || fail "curl is required"
command -v jq >/dev/null 2>&1 || fail "jq is required"

CONTAINER="crewsafe-ml-smoke-${GITHUB_RUN_ID:-local}-$$"
cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN \
  -u AWS_PROFILE -u AWS_SHARED_CREDENTIALS_FILE -u AWS_CONFIG_FILE \
  -u AWS_WEB_IDENTITY_TOKEN_FILE -u AWS_ROLE_ARN \
  docker run --pull never -d --name "$CONTAINER" \
    -e AWS_EC2_METADATA_DISABLED=true \
    -p 127.0.0.1::8000 "$IMAGE" >/dev/null \
  || fail "container did not start"

port="$(docker port "$CONTAINER" 8000/tcp | awk 'NR == 1 { print $NF }')"
[[ "$port" =~ ^(127\.0\.0\.1|0\.0\.0\.0|localhost):[0-9]+$ ]] \
  || fail "container did not expose a loopback HTTP port"
BASE_URL="http://$port"

health=''
for ((attempt = 1; attempt <= RETRIES; attempt++)); do
  if health="$(curl -fsS --max-time 5 "$BASE_URL/health" 2>/dev/null)" \
    && jq -e '.status == "ok" and (keys | length) == 1' <<<"$health" >/dev/null; then
    break
  fi
  health=''
  (( attempt < RETRIES )) && sleep "$RETRY_DELAY"
done
[[ -n "$health" ]] || fail "health endpoint did not become ready"

forecast_request='{"metric":"wbgt","horizon_minutes":30,"current_value":35.5}'
forecast="$(curl -fsS --max-time 5 -H 'Content-Type: application/json' \
  --data "$forecast_request" "$BASE_URL/forecast" 2>/dev/null)" \
  || fail "forecast endpoint did not return within 5 seconds"
jq -e '
  .metric == "wbgt" and .horizon_minutes == 30
  and (.predicted_value | type == "number")
  and (.model_version | type == "string" and length > 0)
  and (.confidence_interval_lower | type == "number")
  and (.confidence_interval_upper | type == "number")
  and (.timestamp | type == "string" and length > 0)
' <<<"$forecast" >/dev/null || fail "forecast response did not match the committed contract"

runtime_user="$(docker inspect --format '{{.Config.User}}' "$CONTAINER")"
[[ -n "$runtime_user" && "$runtime_user" != 'root' && "$runtime_user" != '0' && "$runtime_user" != '0:0' ]] \
  || fail "container runtime user is privileged"
docker exec "$CONTAINER" sh -c 'test ! -w /app/requirements.txt' \
  || fail "runtime user can modify requirements.txt"

printf '%s\n' 'ML-service smoke: health, forecast, non-root runtime, and immutable dependency checks passed.'
