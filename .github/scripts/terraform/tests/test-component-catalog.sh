#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/helpers/test-helpers.sh"

catalog="$ROOT/.github/terraform/components.json"
schema="$ROOT/.github/terraform/components.schema.json"
resolver="$ROOT/.github/scripts/terraform/resolve-component.sh"
assert_file ".github/terraform/components.json"
assert_file ".github/terraform/components.schema.json"
assert_file ".github/scripts/terraform/resolve-component.sh"
jq -e '.schema_version == 1 and (.components | keys | sort == ["cognito-shared-dev","network-shared-dev","state-backend"])' "$catalog" >/dev/null
jq -e '.components["cognito-shared-dev"].state_key == "crewsafe/cognito/shared-dev.tfstate"' "$catalog" >/dev/null
jq -e '.components["network-shared-dev"].state_key == "crewsafe/network/shared-dev.tfstate"' "$catalog" >/dev/null
# The network underpins the database and compute components, so an accidental
# destroy dispatch must stay refused (SCRUM-173 FR-018).
jq -e '.components["network-shared-dev"].allow_destroy == false' "$catalog" >/dev/null
jq empty "$schema"
"$resolver" state-backend >/dev/null
if [[ -f "$ROOT/infra/terraform/cognito/.terraform.lock.hcl" ]]; then
  "$resolver" cognito-shared-dev >/dev/null
elif "$resolver" cognito-shared-dev >/dev/null 2>&1; then
  fail "component with a missing lockfile was accepted"
fi
if [[ -f "$ROOT/infra/terraform/network/.terraform.lock.hcl" ]]; then
  "$resolver" network-shared-dev >/dev/null
elif "$resolver" network-shared-dev >/dev/null 2>&1; then
  fail "component with a missing lockfile was accepted"
fi
if "$resolver" ../escape >/dev/null 2>&1; then fail "path traversal accepted"; fi
if "$resolver" unknown >/dev/null 2>&1; then fail "unknown component accepted"; fi
