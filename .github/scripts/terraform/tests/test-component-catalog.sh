#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/helpers/test-helpers.sh"

catalog="$ROOT/.github/terraform/components.json"
schema="$ROOT/.github/terraform/components.schema.json"
resolver="$ROOT/.github/scripts/terraform/resolve-component.sh"
assert_file ".github/terraform/components.json"
assert_file ".github/terraform/components.schema.json"
assert_file ".github/scripts/terraform/resolve-component.sh"
jq -e '.schema_version == 1 and (.components | keys | sort == ["cognito-shared-dev","compute-shared-dev","database-shared-dev","ecr-shared-dev","iam-policy-management-shared-dev","network-shared-dev","secrets-shared-dev","securityhub-import-shared-dev","state-backend"])' "$catalog" >/dev/null
jq -e '.components["iam-policy-management-shared-dev"].execution_role_family == "policy-management"' "$catalog" >/dev/null
jq -e '.components["iam-policy-management-shared-dev"].allow_destroy == false' "$catalog" >/dev/null
jq -e '.components["cognito-shared-dev"].state_key == "crewsafe/cognito/shared-dev.tfstate"' "$catalog" >/dev/null
jq -e '.components["ecr-shared-dev"].state_key == "crewsafe/ecr/shared-dev.tfstate"' "$catalog" >/dev/null
jq -e '.components["network-shared-dev"].state_key == "crewsafe/network/shared-dev.tfstate"' "$catalog" >/dev/null
jq -e '.components["secrets-shared-dev"].state_key == "crewsafe/secrets/shared-dev.tfstate"' "$catalog" >/dev/null
jq -e '.components["database-shared-dev"].state_key == "crewsafe/database/shared-dev.tfstate"' "$catalog" >/dev/null
jq -e '.components["compute-shared-dev"].state_key == "crewsafe/compute/shared-dev.tfstate"' "$catalog" >/dev/null
# The network underpins the database and compute components, so an accidental
# destroy dispatch must stay refused (SCRUM-173 FR-018).
jq -e '.components["network-shared-dev"].allow_destroy == false' "$catalog" >/dev/null
# The secrets component holds the entries and roles the database and compute
# components read from, so its destroy dispatch must stay refused too
# (SCRUM-174 FR-023). Destroying it would orphan every running task's
# configuration while leaving the secrets themselves in a pending-deletion state.
jq -e '.components["secrets-shared-dev"].allow_destroy == false' "$catalog" >/dev/null
# The database holds the staging data every backend lane depends on, so a destroy
# dispatch must stay refused (SCRUM-175 FR-026). This is the first of two
# independent refusals: the catalogue guard here, and deletion protection at the
# service itself. Losing this instance blocks every lane at once.
jq -e '.components["database-shared-dev"].allow_destroy == false' "$catalog" >/dev/null
# The compute component is the only internet-reachable surface in the account and
# the only thing serving the deployed backend, so a destroy dispatch must stay
# refused (SCRUM-176 FR-051). Destroying it takes the staging URL down for every
# lane at once, and the distribution's provider-issued name is not recoverable —
# a rebuild hands out a different hostname, breaking every client that stored it.
jq -e '.components["compute-shared-dev"].allow_destroy == false' "$catalog" >/dev/null
# SCRUM-274 extends this existing ECR component; it must not add a second
# catalog entry, state key, root, or destroy exception.
jq -e '.components["ecr-shared-dev"].root == "infra/terraform/ecr" and .components["ecr-shared-dev"].state_key == "crewsafe/ecr/shared-dev.tfstate" and .components["ecr-shared-dev"].allow_destroy == false' "$catalog" >/dev/null
# The backend CI pipeline pushes to this repository on every merge to main, so an
# accidental destroy dispatch must stay refused too.
jq -e '.components["ecr-shared-dev"].allow_destroy == false' "$catalog" >/dev/null
jq -e '.components["securityhub-import-shared-dev"].root == "infra/terraform/securityhub-import" and .components["securityhub-import-shared-dev"].state_key == "crewsafe/securityhub-import/shared-dev.tfstate" and .components["securityhub-import-shared-dev"].allow_destroy == false and .components["securityhub-import-shared-dev"].execution_role_family == "standard"' "$catalog" >/dev/null
jq empty "$schema"
"$resolver" state-backend >/dev/null
"$resolver" iam-policy-management-shared-dev >/dev/null
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
if [[ -f "$ROOT/infra/terraform/database/.terraform.lock.hcl" ]]; then
  "$resolver" database-shared-dev >/dev/null
elif "$resolver" database-shared-dev >/dev/null 2>&1; then
  fail "component with a missing lockfile was accepted"
fi
if [[ -f "$ROOT/infra/terraform/compute/.terraform.lock.hcl" ]]; then
  "$resolver" compute-shared-dev >/dev/null
elif "$resolver" compute-shared-dev >/dev/null 2>&1; then
  fail "component with a missing lockfile was accepted"
fi
if [[ -f "$ROOT/infra/terraform/ecr/.terraform.lock.hcl" ]]; then
  "$resolver" ecr-shared-dev >/dev/null
elif "$resolver" ecr-shared-dev >/dev/null 2>&1; then
  fail "component with a missing lockfile was accepted"
fi
if [[ -f "$ROOT/infra/terraform/securityhub-import/.terraform.lock.hcl" ]]; then
  "$resolver" securityhub-import-shared-dev >/dev/null
elif "$resolver" securityhub-import-shared-dev >/dev/null 2>&1; then
  fail "component with a missing lockfile was accepted"
fi
if "$resolver" ../escape >/dev/null 2>&1; then fail "path traversal accepted"; fi
if "$resolver" unknown >/dev/null 2>&1; then fail "unknown component accepted"; fi
