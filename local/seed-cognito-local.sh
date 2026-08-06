#!/usr/bin/env bash
#
# Seeds the local Cognito emulator and prints the environment both halves of the app need.
#
# WHY THIS EXISTS
# `run.sh` resolves the shared dev pool from a GitHub repository variable, so it needs `gh`
# authenticated against the repo plus the synthetic users' passwords from AWS Secrets
# Manager. Without an AWS account you cannot sign in at all, which means you cannot see any
# screen that reads live data — the whole app falls back to fixtures.
#
# This replaces the pool, not the security. `jagregory/cognito-local` is the same image
# `AbstractIntegrationTest` runs: the real Cognito Identity Provider HTTP API, signing
# genuine RS256 tokens and serving a genuine JWKS. Tokens it mints go through the resource
# server, the issuer and client-id checks and every @PreAuthorize for real. Nothing is
# bypassed; only the issuer is local.
#
# USAGE
#   ./local/seed-cognito-local.sh              # start, seed, print env
#   ./local/seed-cognito-local.sh --token      # also print a ready-to-use access token
#
# It is idempotent: re-running replaces the container and mints a fresh pool.
set -euo pipefail
cd "$(dirname "$0")/.."

PRINT_TOKEN=false
RESET_DB=false
while (($#)); do
  case "$1" in
    --token) PRINT_TOKEN=true; shift ;;
    --reset-db) RESET_DB=true; shift ;;
    -h|--help) echo "Usage: ./local/seed-cognito-local.sh [--token] [--reset-db]"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# Pinned to the same digest as AbstractIntegrationTest. An upstream push to :latest must not
# be able to change token shape underneath a verification run.
IMAGE="jagregory/cognito-local@sha256:a5ad30d01da5016a38535a717f6e1642d1b37f886a7b17e90b67f6e5ad134831"
PORT=9229
PASSWORD="Test-Password-2026!"
CONTAINER="crewsafe-cognito-local"

for command_name in docker curl python; do
  command -v "$command_name" >/dev/null || { echo "$command_name is required." >&2; exit 1; }
done

# Every run mints a NEW pool, so every run produces new Cognito subjects — and a subject is
# immutable. `DemoDataSeeder.reconcileIdentity` throws "Application-user mapping conflicts
# with an existing immutable Cognito subject" when it finds `worker1` already in the database
# under yesterday's sub, and the backend refuses to start. That is the guard working, not a
# bug, so re-seeding means resetting the database too.
#
# Safe to drop here and nowhere else: this volume holds the demo seed and ingested weather,
# both of which are recreated on the next start.
if [[ "$RESET_DB" == true ]]; then
  echo "Dropping the local database volume…"
  docker compose -f local/compose.yaml down -v >/dev/null 2>&1 || true
  docker compose -f local/compose.yaml up -d postgres >/dev/null
  for _ in $(seq 1 30); do
    docker exec crewsafe-postgres pg_isready -U crewsafe -d crewsafe >/dev/null 2>&1 && break
    sleep 1
  done
fi

# The config is what allows plain usernames like `worker1`. Without it cognito-local demands
# an email and AdminCreateUser fails with "Username should be an email".
#
# Two Windows-only hazards, both of which cost real time here. Docker will not accept an MSYS
# path (`/c/…`) for a bind mount, so it must be converted — `cygpath -m` yields `C:/…` and
# does not exist off Windows, which is exactly the test. And MSYS rewrites anything that
# looks like an absolute path in a command argument, which is why the container-side path is
# built from a variable that MSYS_NO_PATHCONV protects rather than written inline.
CONFIG="$(pwd)/backend/src/test/resources/cognito-local-config.json"
if command -v cygpath >/dev/null 2>&1; then
  CONFIG="$(cygpath -m "$CONFIG")"
fi

echo "Starting $CONTAINER…"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
# Read-only, because it is a checked-in test resource and the container writes to its own
# config directory: the first run of this script rewrote the file in place and stripped its
# trailing newline, turning a verification run into a spurious diff on a backend fixture.
MSYS_NO_PATHCONV=1 docker run -d --name "$CONTAINER" -p "$PORT:9229" \
  -v "$CONFIG:/app/.cognito/config.json:ro" \
  "$IMAGE" >/dev/null

# The emulator answers before it logs "running", so poll rather than sleep a guessed number.
for _ in $(seq 1 30); do
  curl -s -o /dev/null "http://localhost:$PORT/" && break
  sleep 1
done

cog() {
  curl -s -X POST "http://localhost:$PORT/" \
    -H "Content-Type: application/x-amz-json-1.1" \
    -H "X-Amz-Target: AWSCognitoIdentityProviderService.$1" \
    -H "Authorization: AWS4-HMAC-SHA256 Credential=local/00000000/us-east-1/cognito-idp/aws4_request" \
    -d "$2"
}

jsonpath() { python -c "import sys,json;d=json.load(sys.stdin);print($1)"; }

POOL=$(cog CreateUserPool '{"PoolName":"crewsafe-local"}' | jsonpath "d['UserPool']['Id']")
CLIENT=$(cog CreateUserPoolClient \
  "{\"UserPoolId\":\"$POOL\",\"ClientName\":\"local-cli\",\"ExplicitAuthFlows\":[\"ALLOW_USER_PASSWORD_AUTH\",\"ALLOW_REFRESH_TOKEN_AUTH\"]}" \
  | jsonpath "d['UserPoolClient']['ClientId']")

# Only the users DemoDataSeeder needs for the worker and supervisor screens. Adding the rest
# costs nothing but makes the mapping below longer than it needs to be to prove the path.
declare -A SUBS
for username in worker1 manager1; do
  CREATED=$(cog AdminCreateUser \
    "{\"UserPoolId\":\"$POOL\",\"Username\":\"$username\",\"MessageAction\":\"SUPPRESS\"}")

  # Checked rather than piped straight into the parser, because the failure that actually
  # happens here — the config mount not taking — otherwise surfaces as a KeyError traceback
  # naming neither the cause nor the fix.
  if ! grep -q '"User"' <<<"$CREATED"; then
    echo "Creating $username failed: $CREATED" >&2
    echo "\"Username should be an email\" means the config bind mount did not take." >&2
    exit 1
  fi

  SUBS[$username]=$(jsonpath "[a['Value'] for a in d['User']['Attributes'] if a['Name']=='sub'][0]" <<<"$CREATED")
  cog AdminSetUserPassword \
    "{\"UserPoolId\":\"$POOL\",\"Username\":\"$username\",\"Password\":\"$PASSWORD\",\"Permanent\":true}" >/dev/null
done

DEMO_USERS=$(cat <<EOF
[{"username":"worker1","cognitoSub":"${SUBS[worker1]}","displayName":"Meng Hui (Worker)","role":"WORKER","siteCodes":["bishan"],"identityKind":"developer","desiredStatus":"preserve"},
 {"username":"manager1","cognitoSub":"${SUBS[manager1]}","displayName":"Wei Ling (Safety Manager)","role":"SAFETY_MANAGER","siteCodes":["bishan","campus"],"identityKind":"developer","desiredStatus":"preserve"}]
EOF
)

cat <<EOF

Cognito Local seeded. Pool $POOL, client $CLIENT.

── 1. Backend ──────────────────────────────────────────────────────────────────────────
The issuer is a fixed name, not where the emulator is reachable — see CognitoProperties.
WEATHER_INGESTION_ENABLED is what makes this worth doing: without it the scheduler never
runs, weather_observation stays empty and every site 404s.

export SPRING_PROFILES_ACTIVE=local
export APP_COGNITO_ISSUER_URI='http://cognito-local/$POOL'
export APP_COGNITO_JWK_SET_URI='http://localhost:$PORT/$POOL/.well-known/jwks.json'
export APP_COGNITO_CLIENT_IDS='$CLIENT'
export APP_COGNITO_DEMO_USERS_JSON='$DEMO_USERS'
export DB_URL='jdbc:postgresql://localhost:5434/crewsafe'
export WEATHER_DATA_MODE=live
export WEATHER_INGESTION_ENABLED=true
cd backend && ./mvnw spring-boot:run

── 2. mobile/.env ──────────────────────────────────────────────────────────────────────
10.0.2.2 is the Android emulator's alias for this machine; use your LAN IP on a phone.

EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:8080
EXPO_PUBLIC_AUTH_MODE=cognito-password
EXPO_PUBLIC_COGNITO_IDP_ENDPOINT=http://10.0.2.2:$PORT
EXPO_PUBLIC_COGNITO_CLI_CLIENT_ID=$CLIENT

── 3. Sign in ──────────────────────────────────────────────────────────────────────────
Username worker1 (or manager1, who has both sites), password $PASSWORD
EOF

if [[ "$PRINT_TOKEN" == true ]]; then
  TOKEN=$(cog InitiateAuth \
    "{\"AuthFlow\":\"USER_PASSWORD_AUTH\",\"ClientId\":\"$CLIENT\",\"AuthParameters\":{\"USERNAME\":\"manager1\",\"PASSWORD\":\"$PASSWORD\"}}" \
    | jsonpath "d['AuthenticationResult']['AccessToken']")
  cat <<EOF

── A token for curl ────────────────────────────────────────────────────────────────────
export TOKEN='$TOKEN'
curl -s -H "Authorization: Bearer \$TOKEN" http://localhost:8080/api/v1/sites
EOF
fi
