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
#   ./local/seed-cognito-local.sh --restart                 # the one you usually want
#   ./local/seed-cognito-local.sh --env password            # seed + write mobile/.env
#   ./local/seed-cognito-local.sh                           # seed, print env, change nothing
#   ./local/seed-cognito-local.sh --token                   # also print an access token
#
# It is idempotent: re-running replaces the container and mints a fresh pool.
#
# ── RE-SEEDING INVALIDATES A RUNNING STACK ──────────────────────────────────────────────
# Every run mints a new pool with new client ids and deletes the previous one, so the
# backend, mobile/.env and Metro all have to move to it together. Leaving one behind gives
# an error that names the wrong cause: a deleted client id surfaces in the app as "the app
# is not configured", naming a variable you can see is set.
#
# `--restart` exists because doing that by hand is three steps that must not be interleaved,
# and `--env` exists because the two printed blocks are easy to confuse — password and
# hosted UI differ only in a few lines, and picking the wrong one fails much later.
set -euo pipefail
cd "$(dirname "$0")/.."

PRINT_TOKEN=false
RESET_DB=false
RESTART_BACKEND=false
WRITE_ENV=""

usage() {
  cat <<'USAGE'
Usage: ./local/seed-cognito-local.sh [options]

  --restart            Re-seed, write mobile/.env for cognito-password, and relaunch the
                       backend. Implies --reset-db and --env password. The usual choice.
  --env <mode>         Write mobile/.env for `password` or `hosted-ui` instead of printing
                       two blocks to copy. Preserves every other line in the file and keeps
                       a .env.bak.
  --reset-db           Drop the database volume. Required whenever the pool changes.
  --token              Also print a ready-to-use access token for curl.
  -h, --help           This.
USAGE
}

while (($#)); do
  case "$1" in
    --token) PRINT_TOKEN=true; shift ;;
    --reset-db) RESET_DB=true; shift ;;
    --restart) RESTART_BACKEND=true; RESET_DB=true; WRITE_ENV=password; shift ;;
    --env)
      WRITE_ENV="${2:-}"
      [[ "$WRITE_ENV" == "password" || "$WRITE_ENV" == "hosted-ui" ]] || {
        echo "--env takes 'password' or 'hosted-ui'." >&2; exit 1; }
      shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
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

# The binary existing is not the same as the daemon running, and that is the usual state of
# a machine that has just booted. Without this the first `docker run` fails with a raw
# "failed to connect to the docker API at npipe://…" that says nothing about what to do.
if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed but not running. Start Docker Desktop and try again." >&2
  exit 1
fi

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

  # Compose interpolates and validates EVERY service's `${VAR:?}` before it does anything,
  # including services you did not name — so bringing up `postgres` alone still fails on the
  # backend's and web's required Cognito variables. They are never read here: the containers
  # those belong to are not started. Placeholders exist purely to satisfy interpolation.
  export APP_COGNITO_ISSUER_URI=unused APP_COGNITO_JWK_SET_URI=unused \
    APP_COGNITO_CLIENT_IDS=unused APP_COGNITO_DEMO_USERS_JSON='[]' \
    VITE_COGNITO_AUTHORITY=unused VITE_COGNITO_CLIENT_ID=unused \
    VITE_COGNITO_HOSTED_UI_DOMAIN=unused

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
# ── WHY A COPY, AND WHY A WHOLE DIRECTORY ───────────────────────────────────────────────
# `/app/.cognito` is the emulator's own state directory: it rewrites config.json on boot and
# persists pools beside it. Bind-mounting the checked-in fixture directly therefore modifies
# a backend test resource — the first version of this script stripped its trailing newline
# and produced a spurious diff. Mounting it `:ro` is worse, not better: the container needs
# to write there and exits with EROFS. So the fixture is copied into a scratch directory and
# that directory is mounted, which leaves the repository untouched and the container happy.
#
# Wiped each run, so a stale pool from a previous run can never be mistaken for a fresh one.
#
# Two Windows-only hazards, both of which cost real time here. Docker will not accept an MSYS
# path (`/c/…`) for a bind mount, so it must be converted — `cygpath -m` yields `C:/…` and
# does not exist off Windows, which is exactly the test. And MSYS rewrites anything that
# looks like an absolute path in a command argument, which is why the container-side path is
# built from a variable that MSYS_NO_PATHCONV protects rather than written inline.
STATE_DIR="$(pwd)/local/.cognito-local"
rm -rf "$STATE_DIR"
mkdir -p "$STATE_DIR"
cp backend/src/test/resources/cognito-local-config.json "$STATE_DIR/config.json"

MOUNT="$STATE_DIR"
if command -v cygpath >/dev/null 2>&1; then
  MOUNT="$(cygpath -m "$MOUNT")"
fi

echo "Starting $CONTAINER…"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
MSYS_NO_PATHCONV=1 docker run -d --name "$CONTAINER" -p "$PORT:9229" \
  -v "$MOUNT:/app/.cognito" \
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

# Two clients, mirroring the two real ones, because the app's two Cognito modes need
# different things. `cognito-password` needs ALLOW_USER_PASSWORD_AUTH and no redirect;
# `cognito-pkce` needs a registered callback and the authorization-code flow.
CLIENT=$(cog CreateUserPoolClient \
  "{\"UserPoolId\":\"$POOL\",\"ClientName\":\"local-cli\",\"ExplicitAuthFlows\":[\"ALLOW_USER_PASSWORD_AUTH\",\"ALLOW_REFRESH_TOKEN_AUTH\"]}" \
  | jsonpath "d['UserPoolClient']['ClientId']")

# cognito-local really does serve the Hosted UI: /oauth2/authorize renders a username and
# password form and honours PKCE. So `cognito-pkce` works locally too, with no code change —
# it already reads its domain from EXPO_PUBLIC_COGNITO_HOSTED_UI_DOMAIN.
#
# 5173 is not arbitrary: it is the port `npm run web:pkce` serves on and the callback the
# real web client registers, so the same URL works against AWS and against this.
WEB_CLIENT=$(cog CreateUserPoolClient \
  "{\"UserPoolId\":\"$POOL\",\"ClientName\":\"local-web\",\"CallbackURLs\":[\"http://localhost:5173/callback\"],\"LogoutURLs\":[\"http://localhost:5173/\"],\"AllowedOAuthFlows\":[\"code\"],\"AllowedOAuthScopes\":[\"openid\",\"email\",\"profile\"],\"AllowedOAuthFlowsUserPoolClient\":true,\"SupportedIdentityProviders\":[\"COGNITO\"]}" \
  | jsonpath "d['UserPoolClient']['ClientId']")

# The whole demo roster, matching AbstractIntegrationTest's mapping exactly — same usernames,
# roles and site codes. Seeding only a worker and a manager (the first version of this script)
# meant SUPERVISOR and ADMIN could not be signed in as at all, so two of the four role-based
# navigation paths were unreachable and nobody could tell whether they worked.
#
# `site_codes` values are the only two the seeder reconciles; anything else is rejected.
declare -A SUBS
declare -A ROLE=(
  [supervisor1]=SUPERVISOR [supervisor2]=SUPERVISOR
  [worker1]=WORKER [worker2]=WORKER [worker3]=WORKER
  [manager1]=SAFETY_MANAGER [admin1]=ADMIN
)
declare -A SITES=(
  [supervisor1]='["bishan"]' [supervisor2]='["campus"]'
  [worker1]='["bishan"]' [worker2]='["bishan"]' [worker3]='["bishan"]'
  [manager1]='["bishan","campus"]'
  # An administrator holds every permission a supervisor does but belongs to no site — that
  # is the case that catches code assuming a membership always exists.
  [admin1]='[]'
)
declare -A LABEL=(
  [supervisor1]='Aisyah (Supervisor)' [supervisor2]='Rajesh (Supervisor)'
  [worker1]='Meng Hui (Worker)' [worker2]='Siti (Worker)' [worker3]='Kumar (Worker)'
  [manager1]='Wei Ling (Safety Manager)' [admin1]='System Administrator'
)

USERNAMES=(supervisor1 supervisor2 worker1 worker2 worker3 manager1 admin1)

for username in "${USERNAMES[@]}"; do
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

# Built rather than written out, so the roster above is the single place a user is defined.
DEMO_USERS="["
for username in "${USERNAMES[@]}"; do
  [[ "$DEMO_USERS" != "[" ]] && DEMO_USERS+=","
  DEMO_USERS+="{\"username\":\"$username\",\"cognitoSub\":\"${SUBS[$username]}\""
  DEMO_USERS+=",\"displayName\":\"${LABEL[$username]}\",\"role\":\"${ROLE[$username]}\""
  DEMO_USERS+=",\"siteCodes\":${SITES[$username]}"
  DEMO_USERS+=",\"identityKind\":\"developer\",\"desiredStatus\":\"preserve\"}"
done
DEMO_USERS+="]"

# One source of truth for the backend environment: --restart sources this, and a human can
# too. Retyping it from the screen is how a stale client id gets left behind.
BACKEND_ENV="$STATE_DIR/backend-env.sh"
cat > "$BACKEND_ENV" <<ENVEOF
export SPRING_PROFILES_ACTIVE=local
export APP_COGNITO_ISSUER_URI='http://cognito-local/$POOL'
export APP_COGNITO_JWK_SET_URI='http://localhost:$PORT/$POOL/.well-known/jwks.json'
export APP_COGNITO_CLIENT_IDS='$CLIENT,$WEB_CLIENT'
export APP_COGNITO_DEMO_USERS_JSON='$DEMO_USERS'
export DB_URL='jdbc:postgresql://localhost:5434/crewsafe'
export WEATHER_DATA_MODE=live
export WEATHER_INGESTION_ENABLED=true
export LIGHTNING_INGESTION_ENABLED=true
ENVEOF

# A PowerShell twin, because on Windows the terminal in front of you is usually PowerShell
# and it can do nothing with the file above: `source` is a bash builtin, `&&` is a parse
# error in Windows PowerShell 5.1, and `./mvnw` runs the shell script rather than mvnw.cmd.
# Emitting both removes a whole class of "the instructions do not work here".
BACKEND_ENV_PS1="$STATE_DIR/backend-env.ps1"
python - "$BACKEND_ENV" "$BACKEND_ENV_PS1" <<'PYEOF'
import io, re, sys

source, target = sys.argv[1], sys.argv[2]
lines = [r"# Generated by seed-cognito-local.sh. Dot-source from the repo root:",
         r"#   . .\local\.cognito-localackend-env.ps1"]

for line in io.open(source, encoding="utf-8").read().splitlines():
    match = re.match(r"^export (\w+)=(.*)$", line.strip())
    if not match:
        continue
    name, value = match.group(1), match.group(2)
    if value.startswith("'") and value.endswith("'"):
        value = value[1:-1]
    # A PowerShell single-quoted string escapes only the single quote, by doubling it. The
    # demo-users JSON is full of double quotes, which need no escaping there — the reason
    # single quotes are used rather than double.
    lines.append("$env:%s = '%s'" % (name, value.replace("'", "''")))

io.open(target, "w", encoding="utf-8").write("
".join(lines) + "
")
PYEOF

cat <<EOF

Cognito Local seeded. Pool $POOL, client $CLIENT.

── 1. Backend ──────────────────────────────────────────────────────────────────────────
The issuer is a fixed name, not where the emulator is reachable — see CognitoProperties.
WEATHER_INGESTION_ENABLED is what makes this worth doing: without it the scheduler never
runs, weather_observation stays empty and every site 404s.

export SPRING_PROFILES_ACTIVE=local
export APP_COGNITO_ISSUER_URI='http://cognito-local/$POOL'
export APP_COGNITO_JWK_SET_URI='http://localhost:$PORT/$POOL/.well-known/jwks.json'
export APP_COGNITO_CLIENT_IDS='$CLIENT,$WEB_CLIENT'
export APP_COGNITO_DEMO_USERS_JSON='$DEMO_USERS'
export DB_URL='jdbc:postgresql://localhost:5434/crewsafe'
export WEATHER_DATA_MODE=live
export WEATHER_INGESTION_ENABLED=true
export LIGHTNING_INGESTION_ENABLED=true
cd backend && ./mvnw spring-boot:run

  or, without retyping any of it:
    bash         source $BACKEND_ENV
    PowerShell   . $BACKEND_ENV_PS1   then   .\mvnw.cmd spring-boot:run

── 2a. mobile/.env — Cognito (password), on the Android emulator ────────────────────────
10.0.2.2 is the emulator's alias for this machine; use your LAN IP on a physical phone.
Restart Metro with \`npm run start:clear\` after editing .env — EXPO_PUBLIC_* is inlined at
bundle time, so a running Metro will keep serving the old values.

EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:8080
EXPO_PUBLIC_AUTH_MODE=cognito-password
EXPO_PUBLIC_COGNITO_IDP_ENDPOINT=http://10.0.2.2:$PORT
EXPO_PUBLIC_COGNITO_CLI_CLIENT_ID=$CLIENT

── 2b. mobile/.env — Cognito (hosted UI), on Expo web only ──────────────────────────────
Run with \`npm run web:pkce\`. Expo Go cannot complete this flow on a phone: its redirect is
exp://, which is not a registered callback on any client. localhost here, not 10.0.2.2 —
the browser is on this machine.

EXPO_PUBLIC_API_BASE_URL=http://localhost:8080
EXPO_PUBLIC_AUTH_MODE=cognito-pkce
EXPO_PUBLIC_COGNITO_HOSTED_UI_DOMAIN=http://localhost:$PORT
EXPO_PUBLIC_COGNITO_WEB_CLIENT_ID=$WEB_CLIENT

── 3. Sign in ──────────────────────────────────────────────────────────────────────────
Every account below uses the password $PASSWORD

  worker1, worker2, worker3   WORKER          My shift / Alerts / Weather / Profile
  supervisor1                 SUPERVISOR      Shifts / Weather / Profile  (Bishan)
  supervisor2                 SUPERVISOR      Shifts / Weather / Profile  (NUS Campus)
  manager1                    SAFETY_MANAGER  Shifts / Weather / Profile  (both sites)
  admin1                      ADMIN           Shifts / Weather / Profile  (no site)

Only a WORKER sees My shift and Alerts: /shifts/me is scoped to the caller's own assignment
and the dispatch inbox is WORKER-only, so those tabs would be dead ends for anyone else.
admin1 belongs to no site and is the account that shows the empty-membership state.
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

# ── Writing mobile/.env ─────────────────────────────────────────────────────────────────
# Rewrites only the keys that belong to the chosen mode and leaves every other line — the
# comments, the region, the unused client ids — exactly as it found them. A wholesale
# rewrite would silently discard whatever a developer had set for their own phone.
#
# Python rather than sed: the file has comment lines containing the same key names, and a
# naive `sed s/^KEY=.*/` is fine right up until someone documents a key in a comment.
if [[ -n "$WRITE_ENV" ]]; then
  ENV_FILE="mobile/.env"
  [[ -f "$ENV_FILE" ]] || cp mobile/.env.example "$ENV_FILE"
  cp "$ENV_FILE" "$ENV_FILE.bak"

  if [[ "$WRITE_ENV" == "password" ]]; then
    ENV_PAIRS="EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:8080
EXPO_PUBLIC_AUTH_MODE=cognito-password
EXPO_PUBLIC_COGNITO_IDP_ENDPOINT=http://10.0.2.2:$PORT
EXPO_PUBLIC_COGNITO_CLI_CLIENT_ID=$CLIENT"
  else
    # localhost, not 10.0.2.2: the browser runs on this machine, not inside the emulator.
    ENV_PAIRS="EXPO_PUBLIC_API_BASE_URL=http://localhost:8080
EXPO_PUBLIC_AUTH_MODE=cognito-pkce
EXPO_PUBLIC_COGNITO_HOSTED_UI_DOMAIN=http://localhost:$PORT
EXPO_PUBLIC_COGNITO_WEB_CLIENT_ID=$WEB_CLIENT"
  fi

  ENV_PAIRS="$ENV_PAIRS" python - "$ENV_FILE" <<'PYEOF'
import io, os, re, sys

path = sys.argv[1]
pairs = dict(
    line.split("=", 1) for line in os.environ["ENV_PAIRS"].splitlines() if line.strip()
)
lines = io.open(path, encoding="utf-8").read().splitlines()

for key, value in pairs.items():
    # Only a real assignment at the start of a line, never a mention inside a comment.
    pattern = re.compile(rf"^{re.escape(key)}=")
    for index, line in enumerate(lines):
        if pattern.match(line):
            lines[index] = f"{key}={value}"
            break
    else:
        lines.append(f"{key}={value}")

io.open(path, "w", encoding="utf-8").write("\n".join(lines) + "\n")
print(f"Wrote {path}:")
for key, value in pairs.items():
    print(f"  {key}={value}")
PYEOF

  echo "  (previous file kept as $ENV_FILE.bak)"
  echo
  echo "  Metro must be restarted to pick this up: cd mobile && npm run start:clear"
fi

# ── Relaunching the backend ─────────────────────────────────────────────────────────────
if [[ "$RESTART_BACKEND" == true ]]; then
  echo
  echo "Restarting the backend…"

  # Whatever holds 8080 is a backend pointed at the pool this run just deleted, so it can
  # only fail from here. No lsof on Git Bash for Windows, hence the two paths.
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti:8080 2>/dev/null | xargs -r kill -9 2>/dev/null || true
  elif command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -Command \
      "Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue |
       ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }" >/dev/null 2>&1 || true
  fi

  BACKEND_LOG="$STATE_DIR/backend.log"
  (
    # A subshell with its own cd, so the caller's working directory is untouched. Both paths
    # are absolute — STATE_DIR is built from $(pwd) — so they survive the cd unchanged.
    cd backend
    # shellcheck disable=SC1090
    source "$BACKEND_ENV"
    nohup ./mvnw -q -B spring-boot:run > "$BACKEND_LOG" 2>&1 &
  )

  echo "  log: $BACKEND_LOG"
  printf "  waiting for the first NEA ingestion"

  # Health alone is not the finish line: the app has nothing to show until the scheduler has
  # run once, and "no reading yet" is exactly what a too-early check looks like.
  for _ in $(seq 1 90); do
    if grep -q "ingestion completed" "$BACKEND_LOG" 2>/dev/null; then
      echo
      grep -E "Reconciled|ingestion completed" "$BACKEND_LOG" | tail -2 | sed 's/^/  /'
      break
    fi
    if grep -q "APPLICATION FAILED" "$BACKEND_LOG" 2>/dev/null; then
      echo
      echo "  Backend failed to start. Last lines:" >&2
      tail -20 "$BACKEND_LOG" >&2
      exit 1
    fi
    printf "."
    sleep 2
  done
  echo
  echo "  Backend ready. Now: cd mobile && npm run start:clear"
fi
