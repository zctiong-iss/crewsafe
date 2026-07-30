#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

ACCOUNT_ALIAS=""
WITH_WEB=true
RESET_DB=false
while (($#)); do
  case "$1" in
    --account) ACCOUNT_ALIAS="${2:-}"; shift 2 ;;
    --no-web) WITH_WEB=false; shift ;;
    --reset) RESET_DB=true; shift ;;
    -h|--help) echo "Usage: ./run.sh --account <alias> [--no-web] [--reset]"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done
[[ "$ACCOUNT_ALIAS" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || {
  echo "A valid --account alias is required." >&2; exit 1;
}
for command_name in gh jq podman node curl; do
  command -v "$command_name" >/dev/null || { echo "$command_name is required." >&2; exit 1; }
done
gh auth status >/dev/null

CONFIG="$(gh variable get CREWSAFE_SHARED_COGNITO_JSON --json value --jq .value)"
ACCOUNT="$(
  CREWSAFE_SHARED_COGNITO_JSON="$CONFIG" \
    .github/scripts/cognito/resolve-shared-config.sh "$ACCOUNT_ALIAS"
)"

export APP_COGNITO_ISSUER_URI="$(jq -r .issuer_uri <<<"$ACCOUNT")"
export APP_COGNITO_JWK_SET_URI="$(jq -r .jwks_uri <<<"$ACCOUNT")"
export APP_COGNITO_CLIENT_IDS="$(jq -r '[.web_client_id,.mobile_client_id] | join(",")' <<<"$ACCOUNT")"
export APP_COGNITO_DEMO_USERS_JSON="$(jq -c '.application_users | map({
  username:.username,cognitoSub:.cognito_sub,displayName:.display_name,
  role:.role,siteCodes:.site_codes,identityKind:.identity_kind
})' <<<"$ACCOUNT")"
export SPRING_PROFILES_ACTIVE=local
export CORS_ALLOWED_ORIGINS=http://localhost:5173

LOG_DIR=.local-run
COMPOSE=infra/local/compose.yaml
mkdir -p "$LOG_DIR"
BACKEND_PID=""
WEB_PID=""
cleanup() {
  [[ -n "$WEB_PID" ]] && kill "$WEB_PID" 2>/dev/null || true
  [[ -n "$BACKEND_PID" ]] && kill "$BACKEND_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  podman compose -f "$COMPOSE" stop >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

[[ "$RESET_DB" == false ]] || podman compose -f "$COMPOSE" down -v >/dev/null 2>&1 || true
podman compose -f "$COMPOSE" up -d postgres >/dev/null
postgres_ready=false
for _ in $(seq 1 30); do
  if podman exec crewsafe-postgres pg_isready -U crewsafe -d crewsafe >/dev/null 2>&1; then
    postgres_ready=true
    break
  fi
  sleep 1
done
[[ "$postgres_ready" == true ]] || { echo "PostgreSQL did not become ready." >&2; exit 1; }

if [[ "$WITH_WEB" == true ]]; then
  {
    printf 'VITE_COGNITO_AUTHORITY=%s\n' "$(jq -r .issuer_uri <<<"$ACCOUNT")"
    printf 'VITE_COGNITO_CLIENT_ID=%s\n' "$(jq -r .web_client_id <<<"$ACCOUNT")"
    printf 'VITE_COGNITO_HOSTED_UI_DOMAIN=%s\n' "$(jq -r .hosted_ui_url <<<"$ACCOUNT")"
    printf 'VITE_REDIRECT_URI=http://localhost:5173/callback\n'
    printf 'VITE_POST_LOGOUT_REDIRECT_URI=http://localhost:5173/\n'
    printf 'VITE_API_BASE_URL=http://localhost:8080\n'
  } >web/.env.local
fi

(cd backend && ./mvnw -q -B spring-boot:run) >"$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
backend_ready=false
for _ in $(seq 1 90); do
  if curl -fsS --max-time 2 http://localhost:8080/actuator/health >/dev/null 2>&1; then
    backend_ready=true
    break
  fi
  kill -0 "$BACKEND_PID" 2>/dev/null || { tail -30 "$LOG_DIR/backend.log"; exit 1; }
  sleep 1
done
[[ "$backend_ready" == true ]] || { echo "Backend did not become ready." >&2; exit 1; }

if [[ "$WITH_WEB" == true ]]; then
  [[ -d web/node_modules ]] || (cd web && npm ci --silent)
  (cd web && npm run dev) >"$LOG_DIR/web.log" 2>&1 &
  WEB_PID=$!
fi

printf 'CrewSafe uses shared Cognito account alias %s. Logs: %s\n' "$ACCOUNT_ALIAS" "$LOG_DIR"
tail -f "$LOG_DIR/backend.log"
