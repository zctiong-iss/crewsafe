#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
policy="$ROOT/infra/terraform/cognito/main.tf"
for denied in AdminDeleteUser AdminUpdateUserAttributes; do
  if grep -Eq "\"cognito-idp:${denied}\"" "$policy"; then
    exit 1
  fi
done
grep -Fq 'guard-admin-target-kind.sh' "$ROOT/.github/workflows/cognito-user-administration.yml"
grep -Eq 'synthetic-test-users.*(reject|denied|unsupported)|developers' \
  "$ROOT/.github/scripts/cognito/guard-admin-target-kind.sh"
if grep -REn 'admin-delete-user|delete-secret|terraform (apply|destroy)|aws configure' \
  "$ROOT/.github/scripts/cognito/resolve-admin-operation.sh" \
  "$ROOT/.github/scripts/cognito/resolve-synthetic-users.sh" \
  "$ROOT/.github/scripts/cognito/guard-admin-target-kind.sh" \
  "$ROOT/.github/scripts/cognito/reconcile-synthetic-users.sh" \
  "$ROOT/.github/workflows/cognito-user-administration.yml"; then
  exit 1
fi
if grep -Eq '"cognito-idp:ListUserPools"' "$policy"; then
  exit 1
fi
grep -Eq 'resolve-shared-config.sh' "$ROOT/.github/workflows/cognito-user-administration.yml"
for denied in create-user resend delete-user set-password; do
  if grep -Eq "^ *-? *${denied}[),|]" "$ROOT/.github/workflows/cognito-user-administration.yml"; then
    exit 1
  fi
done
