#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
script="$ROOT/.github/scripts/terraform/verify-cognito-deployment.sh"
[[ -x "$script" ]]
grep -Eq 'get-caller-identity' "$script"
grep -Eq 'DeletionProtection' "$script"
grep -Eq 'UserPoolTier' "$script"
grep -Eq 'describe-user-pool-client' "$script"
grep -Eq 'describe-user-pool-domain' "$script"
grep -Eq 'list-groups' "$script"
grep -Eq 'get-role' "$script"
grep -Eq 'state key mismatch' "$script"
grep -Eq 'well-known/jwks.json' "$script"
