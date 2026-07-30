#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
script="$ROOT/.github/scripts/terraform/verify-cognito-deployment.sh"
[[ -x "$script" ]]
rg -q 'get-caller-identity' "$script"
rg -q 'DeletionProtection' "$script"
rg -q 'UserPoolTier' "$script"
rg -q 'describe-user-pool-client' "$script"
rg -q 'describe-user-pool-domain' "$script"
rg -q 'list-groups' "$script"
rg -q 'get-role' "$script"
rg -q 'state key mismatch' "$script"
rg -q 'well-known/jwks.json' "$script"
