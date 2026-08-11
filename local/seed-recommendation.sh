#!/usr/bin/env bash
#
# Seeds a drafted recommendation against a live shift, so US-09 can be exercised end to end
# (SCRUM-119).
#
# ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────
# SCRUM-118 — the agent that drafts a plan — is not built, so nothing in the running system
# creates a `recommendation` row. Without one, the supervisor's Plans tab is permanently empty
# against a real backend and the approve/edit/reject path can only ever be seen in mock mode.
# This writes the row the agent will eventually write, in the shape the agent has already been
# designed to produce (`docs/plans/SCRUM-118-agent-design-plan.md`).
#
# Deliberately a script against the local database rather than a dev-only endpoint: an endpoint
# would be new backend surface that SCRUM-118 immediately replaces, on someone else's module.
# This leaves nothing behind to unpick.
#
# Every mitigation carries an `actionCode` from `ActionCatalogue`, so the dispatches that follow
# an approval reach workers in their own language. A plan seeded without codes would exercise the
# legacy placeholder path instead, which is not what anyone is trying to test.
#
# Usage:
#   ./local/seed-recommendation.sh            # attach to the site's most recent shift
#   ./local/seed-recommendation.sh <shiftId>  # attach to a specific shift
#
# @author Justin Chua
set -euo pipefail

CONTAINER="crewsafe-postgres"
DB_USER="crewsafe"
DB_NAME="crewsafe"

if ! docker exec "$CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
  echo "Postgres container '$CONTAINER' is not ready. Start the stack first:" >&2
  echo "  ./local/seed-cognito-local.sh --restart" >&2
  exit 1
fi

psql() { docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -At "$@"; }

SHIFT_ID="${1:-}"
if [ -z "$SHIFT_ID" ]; then
  # Most recently created shift that has not ended — the one a supervisor is most likely to be
  # looking at. Ordering by created_at rather than starts_at matches the shift list's own order.
  SHIFT_ID=$(psql -c "SELECT id FROM shift WHERE ends_at > now() ORDER BY created_at DESC LIMIT 1;")
fi

if [ -z "$SHIFT_ID" ]; then
  echo "No shift found that has not already ended. Plan one in the app first." >&2
  exit 1
fi

# Kept on one line per mitigation for readability in psql output; the column is TEXT holding the
# same Jackson-serialised MitigationSuggestion.Batch that RecommendationService writes.
DRAFT_PLAN=$(cat <<'JSON'
{"mitigations":[
{"priority":"HIGH","action":"Rest 15 minutes in shade every hour","rationale":"Forecast WBGT reaches 33.1 C within 30 minutes on heavy tasks","estimatedImpact":"Keeps core temperature within MOM guidance","actionCode":"REST_15_MIN_HOURLY","category":"REST"},
{"priority":"HIGH","action":"Drink water at least once an hour","rationale":"Sustained sweat loss at this band and intensity","estimatedImpact":"Maintains hydration through the remainder of the shift","actionCode":"HYDRATE_HOURLY","category":"HYDRATION"},
{"priority":"MEDIUM","action":"Move remaining heavy work to after 16:00","rationale":"Band is forecast to fall back below 32 C by late afternoon","estimatedImpact":"Removes roughly two hours of peak-band heavy exposure","actionCode":"RESCHEDULE_HEAVY_WORK","category":"WORK_SCHEDULING"}
]}
JSON
)

RATIONALE="Forecast WBGT crosses into the 33 C band within 30 minutes while workers are on heavy tasks, some still inside the acclimatisation window."

RECOMMENDATION_ID=$(psql <<SQL
INSERT INTO recommendation (id, shift_id, policy_version, draft_plan, status, rationale, created_at)
VALUES (gen_random_uuid(), '${SHIFT_ID}', 'MOM-WBGT-2026.1',
        \$plan\$${DRAFT_PLAN}\$plan\$,
        'PENDING_APPROVAL',
        \$why\$${RATIONALE}\$why\$,
        now())
RETURNING id;
SQL
)

echo "Seeded recommendation ${RECOMMENDATION_ID}"
echo "  on shift ${SHIFT_ID}"
echo
echo "Open the supervisor's Plans tab to approve, edit or reject it."
echo "Approving dispatches one action per worker assigned to that shift, in their own language."
