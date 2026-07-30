#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
policy="$ROOT/infra/terraform/cognito/main.tf"
for denied in AdminCreateUser AdminDeleteUser AdminSetUserPassword AdminUpdateUserAttributes; do
  ! rg -q "\"cognito-idp:$denied\"" "$policy"
done
! rg -q '"cognito-idp:ListUserPools"' "$policy"
rg -q 'resolve-shared-config.sh' "$ROOT/.github/workflows/cognito-user-administration.yml"
for denied in create-user resend delete-user set-password; do
  ! rg -q "^ *-? *$denied[),|]" "$ROOT/.github/workflows/cognito-user-administration.yml"
done
