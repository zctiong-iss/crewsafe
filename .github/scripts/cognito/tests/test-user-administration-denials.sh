#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
policy="$ROOT/infra/terraform/cognito/main.tf"
for denied in AdminCreateUser AdminDeleteUser AdminSetUserPassword AdminUpdateUserAttributes; do
  if grep -Eq "\"cognito-idp:${denied}\"" "$policy"; then
    exit 1
  fi
done
if grep -Eq '"cognito-idp:ListUserPools"' "$policy"; then
  exit 1
fi
grep -Eq 'resolve-shared-config.sh' "$ROOT/.github/workflows/cognito-user-administration.yml"
for denied in create-user resend delete-user set-password; do
  if grep -Eq "^ *-? *${denied}[),|]" "$ROOT/.github/workflows/cognito-user-administration.yml"; then
    exit 1
  fi
done
