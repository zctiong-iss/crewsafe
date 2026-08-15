#!/usr/bin/env bash
#
# Activates a MOM-aligned heat policy version for every local site that has none, so
# "Draft a plan" works against a local stack (SCRUM-289 follow-up).
#
# ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────
# A site created through the API has no policy version at all. V9's seeding INSERT is
# commented out on purpose -- "each site must have its policy configured via application
# setup or admin API" -- and V12 built its carry-forward by selecting FROM heat_rest_policy,
# which was therefore empty. So the catalogue starts empty on every fresh database.
#
# PolicyEngineService signals that with NoSuchElementException, AgentDraftService turns it
# into a 409 carrying ErrorCode.NO_ACTIVE_POLICY, and the supervisor's "Draft a plan" button
# fails every single time on a stack nobody has seeded. Before that code existed the dialog
# read "Someone else changed this first. Reload and try again." -- advice that could never
# work, because reloading does not create a policy version.
#
# ── WHY A SCRIPT AND NOT A MIGRATION ────────────────────────────────────────────────────
# The obvious fix is a Flyway migration that seeds every site. It is the wrong one. V9's
# comment is a deliberate safety position, not an oversight: thresholds decide what a worker
# is required to do in the heat, and §7.1 makes them configuration records a Safety Manager
# signs off on rather than values the system invents. A migration that silently activated
# defaults would mean a real site in production evaluating real workers against numbers
# nobody at that site ever approved -- and doing it invisibly, because a migration leaves no
# trace in the app.
#
# So production keeps requiring a human, and local development gets this. The thresholds
# below are the same MOM-aligned defaults V9's commented-out block used, and the version is
# labelled so nobody mistakes it for a configured one.
#
# Usage:
#   ./local/seed-policy-version.sh              # every site missing an active policy
#   ./local/seed-policy-version.sh <siteId>     # one specific site
#
# @author Justin Chua
set -euo pipefail

CONTAINER="crewsafe-postgres"
DB_USER="crewsafe"
DB_NAME="crewsafe"

# Labelled LOCAL- so it is obvious in the app's policy list, and in any recommendation that
# cites it, that these thresholds came from a dev script rather than a Safety Manager.
VERSION_LABEL="LOCAL-MOM-WBGT-2026.1"
SOURCE="Local development seed (MOM Work-Rest Guidelines defaults)"

if ! docker exec "$CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
  echo "Postgres container '$CONTAINER' is not ready. Start the stack first:" >&2
  echo "  ./local/seed-cognito-local.sh --restart" >&2
  exit 1
fi

psql() { docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -At "$@"; }

SITE_ID="${1:-}"

# Only sites with no ACTIVE version. uq_policy_version_active_per_site enforces at most one
# per site, so inserting against a site that already has one would fail the unique index --
# and more to the point, overwriting a policy someone deliberately configured is exactly the
# behaviour V9 was written to prevent.
if [ -n "$SITE_ID" ]; then
  SITE_FILTER="AND s.id = '$SITE_ID'"
else
  SITE_FILTER=""
fi

TARGETS=$(psql -c "
  SELECT s.id FROM site s
  WHERE NOT EXISTS (
    SELECT 1 FROM policy_version pv WHERE pv.site_id = s.id AND pv.status = 'ACTIVE'
  ) $SITE_FILTER;
")

if [ -z "$TARGETS" ]; then
  echo "Every site already has an active policy version. Nothing to do."
  exit 0
fi

# `psql` here runs `docker exec -i`, which inherits and drains the loop's stdin -- the second
# site id would be eaten by the first iteration's psql and never seen by `read`. Feeding the
# loop through fd 3 instead of stdin keeps the two apart.
while IFS= read -r site <&3; do
  [ -z "$site" ] && continue
  psql -c "
    INSERT INTO policy_version (
      id, site_id, version_label, source, effective_date, status,
      wbgt_threshold_unacclimatised_light, wbgt_threshold_unacclimatised_moderate,
      wbgt_threshold_unacclimatised_heavy,
      wbgt_threshold_partial_light, wbgt_threshold_partial_moderate, wbgt_threshold_partial_heavy,
      wbgt_threshold_full_light, wbgt_threshold_full_moderate, wbgt_threshold_full_heavy,
      wbgt_emergency_stop, notes, created_at, updated_at, activated_at
    ) VALUES (
      gen_random_uuid(), '$site', '$VERSION_LABEL', '$SOURCE', CURRENT_DATE, 'ACTIVE',
      25.0, 23.0, 21.0,
      26.0, 24.0, 22.0,
      28.0, 26.0, 24.0,
      33.0,
      'Seeded by local/seed-policy-version.sh for local development. Not a configured policy.',
      now(), now(), now()
    );
  " >/dev/null
  echo "Activated $VERSION_LABEL for site $site"
done 3<<< "$TARGETS"

echo
echo "Done. 'Draft a plan' will now reach the agent instead of failing with NO_ACTIVE_POLICY."
