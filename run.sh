#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

CONTAINER_ENGINE="$(local/resolve-container-engine.sh)"
ACCOUNT_ALIAS="dev"
WITH_WEB=true
RESET_DB=false
WEATHER_MODE=""
while (($#)); do
  case "$1" in
    --account) ACCOUNT_ALIAS="${2:-}"; shift 2 ;;
    --no-web) WITH_WEB=false; shift ;;
    --reset) RESET_DB=true; shift ;;
    --weather)
      WEATHER_MODE="${2:-}"
      [[ "$WEATHER_MODE" == "demo" || "$WEATHER_MODE" == "live" ]] || {
        echo "--weather requires 'demo' or 'live'" >&2; exit 1;
      }
      shift 2 ;;
    -h|--help) echo "Usage: ./run.sh [--account <alias>] [--no-web] [--reset] [--weather demo|live]"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done
[[ "$ACCOUNT_ALIAS" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || {
  echo "A valid --account alias is required." >&2; exit 1;
}
for command_name in gh jq ruby "$CONTAINER_ENGINE" curl; do
  command -v "$command_name" >/dev/null || { echo "$command_name is required." >&2; exit 1; }
done
"$CONTAINER_ENGINE" compose version >/dev/null || {
  echo "$CONTAINER_ENGINE compose is required." >&2
  exit 1
}
gh auth status >/dev/null

CONFIG="$(gh variable get CREWSAFE_SHARED_COGNITO_JSON --json value --jq .value)"
ACCOUNT_REGISTRY="$(gh variable get CREWSAFE_AWS_ACCOUNTS_JSON --json value --jq .value)"
ACCOUNT="$(
  CREWSAFE_SHARED_COGNITO_JSON="$CONFIG" \
    .github/scripts/cognito/resolve-shared-config.sh "$ACCOUNT_ALIAS"
)"

export APP_COGNITO_ISSUER_URI="$(jq -r .issuer_uri <<<"$ACCOUNT")"
export APP_COGNITO_JWK_SET_URI="$(jq -r .jwks_uri <<<"$ACCOUNT")"
# cli_client_id is included so the mobile app's dev-only USER_PASSWORD_AUTH sign-in
# (mobile/src/auth/cognitoPasswordAuth.ts) yields tokens this backend will accept. Expo Go
# cannot complete the Hosted UI redirect — the mobile client's callback is pinned to
# crewsafe://callback, a scheme only a native build registers — so a device cannot obtain a
# mobile-client token at all. The CLI client's ALLOW_USER_PASSWORD_AUTH flow needs no
# redirect and works from Expo Go. Staging already allows all three the same way; see
# infra/terraform/secrets/main.tf. Local development only.
export APP_COGNITO_CLIENT_IDS="$(jq -r '[.web_client_id,.mobile_client_id,.cli_client_id] | join(",")' <<<"$ACCOUNT")"
export APP_COGNITO_DEMO_USERS_JSON="$(
  CREWSAFE_AWS_ACCOUNTS_JSON="$ACCOUNT_REGISTRY" \
  CREWSAFE_SHARED_COGNITO_JSON="$CONFIG" \
    .github/scripts/cognito/build-runtime-mappings.sh "$ACCOUNT_ALIAS"
)"
export VITE_COGNITO_AUTHORITY="$(jq -r .issuer_uri <<<"$ACCOUNT")"
export VITE_COGNITO_CLIENT_ID="$(jq -r .web_client_id <<<"$ACCOUNT")"
export VITE_COGNITO_HOSTED_UI_DOMAIN="$(jq -r .hosted_ui_url <<<"$ACCOUNT")"
export VITE_REDIRECT_URI=http://localhost:5173/callback
export VITE_POST_LOGOUT_REDIRECT_URI=http://localhost:5173/
export VITE_API_BASE_URL=http://localhost:8080
export SPRING_PROFILES_ACTIVE=local
export CORS_ALLOWED_ORIGINS=http://localhost:5173

if [[ "$WEATHER_MODE" == "demo" ]]; then
  export WEATHER_DATA_MODE=fixture
  export WEATHER_INGESTION_ENABLED=true
  export WEATHER_FIXTURE_LOOP=true
  export LIGHTNING_INGESTION_ENABLED=true
  export LIGHTNING_FIXTURE_LOOP=true
  printf 'Weather: fixture replay (demo mode)\n'
elif [[ "$WEATHER_MODE" == "live" ]]; then
  export WEATHER_DATA_MODE=live
  export WEATHER_INGESTION_ENABLED=true
  export LIGHTNING_INGESTION_ENABLED=true
  printf 'Weather: live NEA ingestion\n'
fi

COMPOSE=local/compose.yaml
COMPOSE_COMMAND=("$CONTAINER_ENGINE" compose -f "$COMPOSE")
cleanup() {
  "${COMPOSE_COMMAND[@]}" stop >/dev/null 2>&1 || true
}
trap cleanup INT TERM

[[ "$RESET_DB" == false ]] || "${COMPOSE_COMMAND[@]}" down -v >/dev/null 2>&1 || true
services_to_start=(postgres backend)
services_to_start+=(adminer)
if [[ "$WITH_WEB" == true ]]; then
  services_to_start+=(web)
fi
"${COMPOSE_COMMAND[@]}" up -d "${services_to_start[@]}" >/dev/null
postgres_ready=false
for _ in $(seq 1 30); do
  if "$CONTAINER_ENGINE" exec crewsafe-postgres \
    pg_isready -U crewsafe -d crewsafe >/dev/null 2>&1; then
    postgres_ready=true
    break
  fi
  sleep 1
done
[[ "$postgres_ready" == true ]] || { echo "PostgreSQL did not become ready." >&2; exit 1; }

# Written regardless of --no-web. The file exists so a developer can run Vite on the host
# against this stack, which is precisely the --no-web case; gating it on WITH_WEB left that
# developer with a backend and no configuration. It is regenerated on every run and holds no
# secrets, so writing it when the web container is skipped costs nothing.
{
  printf 'VITE_COGNITO_AUTHORITY=%s\n' "$VITE_COGNITO_AUTHORITY"
  printf 'VITE_COGNITO_CLIENT_ID=%s\n' "$VITE_COGNITO_CLIENT_ID"
  printf 'VITE_COGNITO_HOSTED_UI_DOMAIN=%s\n' "$VITE_COGNITO_HOSTED_UI_DOMAIN"
  printf 'VITE_REDIRECT_URI=%s\n' "$VITE_REDIRECT_URI"
  printf 'VITE_POST_LOGOUT_REDIRECT_URI=%s\n' "$VITE_POST_LOGOUT_REDIRECT_URI"
  printf 'VITE_API_BASE_URL=%s\n' "$VITE_API_BASE_URL"
} >web/.env.local

backend_ready=false
for _ in $(seq 1 90); do
  if curl -fsS --max-time 2 http://localhost:8080/actuator/health >/dev/null 2>&1; then
    backend_ready=true
    break
  fi
  "$CONTAINER_ENGINE" compose -f "$COMPOSE" ps backend >/dev/null 2>&1 || {
    "$CONTAINER_ENGINE" compose -f "$COMPOSE" logs --no-color --tail 30 backend >&2
    exit 1
  }
  sleep 1
done
[[ "$backend_ready" == true ]] || { echo "Backend did not become ready." >&2; exit 1; }

printf 'CrewSafe uses shared Cognito account alias %s. Compose stack is running from %s\n' "$ACCOUNT_ALIAS" "$COMPOSE"
printf 'Containers started in detached mode. Use "%s compose -f %s logs -f backend web" if you need live logs.\n' "$CONTAINER_ENGINE" "$COMPOSE"