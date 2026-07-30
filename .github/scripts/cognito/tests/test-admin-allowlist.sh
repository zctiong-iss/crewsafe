#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
jq -e '.schema_version == 1 and (.accounts | type == "object")' "$ROOT/.github/cognito/admins.json" >/dev/null
jq empty "$ROOT/.github/cognito/admins.schema.json"
grep -Eq 'Actor is not authorized' "$ROOT/.github/scripts/cognito/resolve-admin-operation.sh"

resolver="$ROOT/.github/scripts/cognito/resolve-admin-operation.sh"
registry='{"alice":{"account_id":"123456789012"}}'
valid='{"schema_version":1,"accounts":{"alice":["actor"]}}'
CREWSAFE_AWS_ACCOUNTS_JSON="$registry" CREWSAFE_COGNITO_ADMINS_JSON="$valid" \
  "$resolver" alice list-users "" "" actor >/dev/null

for invalid in \
  '{"schema_version":1,"accounts":{"unknown":["actor"]}}' \
  '{"schema_version":1,"accounts":{"alice":["actor","actor"]}}' \
  '{"schema_version":1,"accounts":{"alice":["Actor"]}}' \
  '{"schema_version":1,"accounts":{"alice":"actor"}}' \
  '{"schema_version":2,"accounts":{"alice":["actor"]}}'; do
  if CREWSAFE_AWS_ACCOUNTS_JSON="$registry" CREWSAFE_COGNITO_ADMINS_JSON="$invalid" \
    "$resolver" alice list-users "" "" actor >/dev/null 2>&1; then
    echo "malformed administrator allowlist was accepted" >&2
    exit 1
  fi
done

if CREWSAFE_AWS_ACCOUNTS_JSON="$registry" CREWSAFE_COGNITO_ADMINS_JSON="$valid" \
  "$resolver" alice list-users "" "" intruder >/dev/null 2>&1; then
  echo "unallowlisted actor was accepted" >&2
  exit 1
fi
