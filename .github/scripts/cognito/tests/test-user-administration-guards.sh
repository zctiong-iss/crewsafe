#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
resolver="$ROOT/.github/scripts/cognito/resolve-admin-operation.sh"
[[ -x "$resolver" ]]

export CREWSAFE_AWS_ACCOUNTS_JSON='{"alice":{"account_id":"123456789012","region":"ap-southeast-1","plan_role_arn":"arn:aws:iam::123456789012:role/plan","apply_role_arn":"arn:aws:iam::123456789012:role/apply","bucket":"state"}}'
export CREWSAFE_COGNITO_ADMINS_JSON='{"schema_version":1,"accounts":{"alice":["actor"]}}'
"$resolver" alice inspect subject-123 "" actor >/dev/null
if "$resolver" alice create-user subject-123 "" actor >/dev/null 2>&1; then exit 1; fi
if "$resolver" alice inspect person@example.com "" actor >/dev/null 2>&1; then exit 1; fi
if "$resolver" alice add-to-group subject-123 administrators actor >/dev/null 2>&1; then exit 1; fi
