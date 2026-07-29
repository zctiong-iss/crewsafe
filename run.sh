#!/usr/bin/env bash
#
# Runs the whole stack locally: Postgres, the backend, and the web console.
#
#   ./run.sh              start everything, follow logs, Ctrl-C to stop
#   ./run.sh --no-web     backend and database only
#   ./run.sh --reset      wipe the database first, so seeding runs from scratch
#
# The backend points at the *staging* Cognito pool rather than cognito-local, because a
# browser login needs a Hosted UI and the emulator does not have one. The pool's settings
# come from Terraform, so nothing here goes stale if the pool is recreated and no real
# pool or client id is committed.
set -euo pipefail

cd "$(dirname "$0")"
ROOT=$(pwd)
TF_DIR=infra/aws/cognito-staging
LOG_DIR=.local-run
COMPOSE="infra/local/compose.yaml"

WITH_WEB=true
RESET_DB=false
for arg in "$@"; do
  case "$arg" in
    --no-web) WITH_WEB=false ;;
    --reset)  RESET_DB=true ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

say()  { printf '\033[36m▸\033[0m %s\n' "$1"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$1"; }
die()  { printf '\033[31m✗\033[0m %s\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------- preflight

command -v podman    >/dev/null || die "podman not found"
command -v terraform >/dev/null || die "terraform not found — it is how this script finds the pool"
command -v node      >/dev/null || die "node not found"

aws sts get-caller-identity >/dev/null 2>&1 \
  || die "No AWS credentials. The seeder calls AdminGetUser to resolve demo users' subs. Run 'aws configure'."

[ -d "$TF_DIR/.terraform" ] \
  || die "Terraform not initialised. Run: cd $TF_DIR && terraform init && terraform apply"

mkdir -p "$LOG_DIR"

# ---------------------------------------------------------------- cleanup

# Kill the children on exit however we get there, so Ctrl-C does not leave a backend
# holding port 8080 and a confusing "port in use" on the next run.
BACKEND_PID=""
WEB_PID=""
cleanup() {
  echo
  say "Stopping"
  [ -n "$WEB_PID" ]     && kill "$WEB_PID"     2>/dev/null || true
  [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  podman compose -f "$COMPOSE" stop >/dev/null 2>&1 || true
  ok "Stopped. Database volume kept — use --reset to wipe it."
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------- database

if [ "$RESET_DB" = true ]; then
  say "Wiping the database"
  podman compose -f "$COMPOSE" down -v >/dev/null 2>&1 || true
fi

say "Starting Postgres"
podman compose -f "$COMPOSE" up -d postgres >/dev/null

for _ in $(seq 1 30); do
  if podman exec crewsafe-postgres pg_isready -U crewsafe -d crewsafe >/dev/null 2>&1; then break; fi
  sleep 1
done
podman exec crewsafe-postgres pg_isready -U crewsafe -d crewsafe >/dev/null 2>&1 \
  || die "Postgres did not become ready"
ok "Postgres ready on 5434"

# ---------------------------------------------------------------- config

say "Reading pool settings from Terraform"
# `terraform output -raw backend_env` prints KEY=VALUE lines. Export them into this shell.
eval "$(terraform -chdir="$TF_DIR" output -raw backend_env | sed 's/^/export /')"
[ -n "${APP_COGNITO_ISSUER_URI:-}" ] \
  || die "No Terraform outputs. Has 'terraform apply' been run in $TF_DIR?"

export SPRING_PROFILES_ACTIVE=staging          # so DemoDataSeeder creates the app_user rows
export CORS_ALLOWED_ORIGINS=http://localhost:5173
ok "Pool ${APP_COGNITO_USER_POOL_ID} in ${APP_COGNITO_REGION}"

# The web app needs the same pool. Generate .env.local if it is missing, so a fresh clone
# does not silently talk to a different pool than the backend trusts.
if [ "$WITH_WEB" = true ] && [ ! -f web/.env.local ]; then
  say "Creating web/.env.local from Terraform"
  cat > web/.env.local <<EOF
VITE_COGNITO_AUTHORITY=$(terraform -chdir="$TF_DIR" output -raw issuer_uri)
VITE_COGNITO_CLIENT_ID=$(terraform -chdir="$TF_DIR" output -raw web_client_id)
VITE_COGNITO_HOSTED_UI_DOMAIN=$(terraform -chdir="$TF_DIR" output -raw hosted_ui_url)
VITE_REDIRECT_URI=http://localhost:5173/callback
VITE_POST_LOGOUT_REDIRECT_URI=http://localhost:5173/
VITE_API_BASE_URL=http://localhost:8080
EOF
  ok "web/.env.local written (gitignored)"
fi

# ---------------------------------------------------------------- backend

say "Starting the backend"
( cd backend && ./mvnw -q -B spring-boot:run ) > "$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!

for _ in $(seq 1 90); do
  if curl -fsS --max-time 2 http://localhost:8080/actuator/health >/dev/null 2>&1; then break; fi
  kill -0 "$BACKEND_PID" 2>/dev/null || { tail -30 "$LOG_DIR/backend.log"; die "Backend exited — see $LOG_DIR/backend.log"; }
  sleep 1
done
curl -fsS --max-time 2 http://localhost:8080/actuator/health >/dev/null 2>&1 \
  || { tail -30 "$LOG_DIR/backend.log"; die "Backend did not become healthy — see $LOG_DIR/backend.log"; }

SEEDED=$(podman exec crewsafe-postgres psql -U crewsafe -d crewsafe -t -A \
          -c "select count(*) from app_user;" 2>/dev/null || echo "?")
ok "Backend on 8080 · ${SEEDED} demo users"

# ---------------------------------------------------------------- web

if [ "$WITH_WEB" = true ]; then
  [ -d web/node_modules ] || { say "Installing web dependencies"; ( cd web && npm install --silent ); }

  say "Starting the web console"
  ( cd web && npm run dev ) > "$LOG_DIR/web.log" 2>&1 &
  WEB_PID=$!

  for _ in $(seq 1 30); do
    if curl -fsS --max-time 2 http://localhost:5173 >/dev/null 2>&1; then break; fi
    kill -0 "$WEB_PID" 2>/dev/null || { tail -20 "$LOG_DIR/web.log"; die "Web server exited — see $LOG_DIR/web.log"; }
    sleep 1
  done
  ok "Web console on 5173"
fi

# ---------------------------------------------------------------- ready

cat <<EOF

  ────────────────────────────────────────────────────────────
   CrewSafe is running
  ────────────────────────────────────────────────────────────
   Console     http://localhost:5173
   API         http://localhost:8080
   API docs    http://localhost:8080/swagger-ui.html

   Sign in with any demo account below.
   Password: see demo_user_password in infra/aws/cognito-staging/terraform.tfvars
   (gitignored — never print the actual value here, or a rotated password goes
   stale in this script and nobody notices).

     supervisor1   Bishan Park · sees Approvals
     supervisor2   NUS Campus  · proves site scoping
     worker1       Bishan Park · Live board only
     manager1      both sites  · adds Audit trail
     admin1        both sites  · adds Settings

   Logs        $LOG_DIR/backend.log, $LOG_DIR/web.log
   Stop        Ctrl-C
  ────────────────────────────────────────────────────────────

EOF

# Follow the backend log until interrupted; the trap handles teardown.
tail -f "$LOG_DIR/backend.log"
