#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/helpers/test-helpers.sh"

catalog="$ROOT/.github/terraform/components.json"
schema="$ROOT/.github/terraform/components.schema.json"
resolver="$ROOT/.github/scripts/terraform/resolve-component.sh"
readonly MISSING_LOCKFILE_ACCEPTED='component with a missing lockfile was accepted'
assert_file ".github/terraform/components.json"
assert_file ".github/terraform/components.schema.json"
assert_file ".github/scripts/terraform/resolve-component.sh"
jq -e '.schema_version == 1 and (.components | keys | sort == ["cognito-shared-dev","compute-shared-dev","database-shared-dev","developer-access-shared-dev","ecr-shared-dev","iam-policy-management-shared-dev","network-shared-dev","secrets-shared-dev","securityhub-import-shared-dev","state-backend"])' "$catalog" >/dev/null
jq -e '.components["iam-policy-management-shared-dev"].execution_role_family == "policy-management"' "$catalog" >/dev/null
jq -e '.components["iam-policy-management-shared-dev"].allow_destroy == false' "$catalog" >/dev/null
jq -e '.components["cognito-shared-dev"].state_key == "crewsafe/cognito/shared-dev.tfstate"' "$catalog" >/dev/null
jq -e '.components["ecr-shared-dev"].state_key == "crewsafe/ecr/shared-dev.tfstate"' "$catalog" >/dev/null
jq -e '.components["network-shared-dev"].state_key == "crewsafe/network/shared-dev.tfstate"' "$catalog" >/dev/null
jq -e '.components["secrets-shared-dev"].state_key == "crewsafe/secrets/shared-dev.tfstate"' "$catalog" >/dev/null
jq -e '.components["database-shared-dev"].state_key == "crewsafe/database/shared-dev.tfstate"' "$catalog" >/dev/null
jq -e '.components["compute-shared-dev"].state_key == "crewsafe/compute/shared-dev.tfstate"' "$catalog" >/dev/null
# --- Decommissioning window -------------------------------------------------
#
# The shared-dev account is being torn down to zero spend. For the duration of
# that teardown the workload components carry allow_destroy: true, which is a
# deliberate, reviewed departure from the refusals SCRUM-173 FR-018, SCRUM-174
# FR-023, SCRUM-175 FR-026, SCRUM-176 FR-051, SCRUM-274, and SCRUM-372 each put
# in place. The follow-up PR that closes the window restores every one of them,
# and this block is what fails if that revert is forgotten or only half done.
#
# The set is asserted exactly, in both directions: a component missing from it
# is still refused, and a component that quietly joins it fails the test.
jq -e '[.components | to_entries[] | select(.value.allow_destroy) | .key] | sort == [
  "cognito-shared-dev",
  "compute-shared-dev",
  "database-shared-dev",
  "developer-access-shared-dev",
  "ecr-shared-dev",
  "network-shared-dev",
  "secrets-shared-dev",
  "securityhub-import-shared-dev"
]' "$catalog" >/dev/null
# Two components are never destroyable, teardown or not. The state backend holds
# every other component's state and carries prevent_destroy; the policy-management
# root owns the very permissions a destroy would need. Neither is in the set above,
# and neither may be added to it.
jq -e '.components["state-backend"].allow_destroy == false' "$catalog" >/dev/null
jq -e '.components["iam-policy-management-shared-dev"].allow_destroy == false' "$catalog" >/dev/null
# Roots and state keys are unaffected by the teardown and must not drift with it.
jq -e '.components["ecr-shared-dev"].root == "infra/terraform/ecr" and .components["ecr-shared-dev"].state_key == "crewsafe/ecr/shared-dev.tfstate"' "$catalog" >/dev/null
jq -e '.components["securityhub-import-shared-dev"].root == "infra/terraform/securityhub-import" and .components["securityhub-import-shared-dev"].state_key == "crewsafe/securityhub-import/shared-dev.tfstate" and .components["securityhub-import-shared-dev"].execution_role_family == "standard"' "$catalog" >/dev/null
# The developer-access component reuses the shared "standard" execution-role
# family rather than a dedicated one (research.md R-001).
jq -e '.components["developer-access-shared-dev"].root == "infra/terraform/developer-access" and .components["developer-access-shared-dev"].state_key == "crewsafe/developer-access/shared-dev.tfstate" and .components["developer-access-shared-dev"].execution_role_family == "standard"' "$catalog" >/dev/null
jq empty "$schema"
"$resolver" state-backend >/dev/null
"$resolver" iam-policy-management-shared-dev >/dev/null
if [[ -f "$ROOT/infra/terraform/cognito/.terraform.lock.hcl" ]]; then
  "$resolver" cognito-shared-dev >/dev/null
elif "$resolver" cognito-shared-dev >/dev/null 2>&1; then
  fail "$MISSING_LOCKFILE_ACCEPTED"
fi
if [[ -f "$ROOT/infra/terraform/network/.terraform.lock.hcl" ]]; then
  "$resolver" network-shared-dev >/dev/null
elif "$resolver" network-shared-dev >/dev/null 2>&1; then
  fail "$MISSING_LOCKFILE_ACCEPTED"
fi
if [[ -f "$ROOT/infra/terraform/database/.terraform.lock.hcl" ]]; then
  "$resolver" database-shared-dev >/dev/null
elif "$resolver" database-shared-dev >/dev/null 2>&1; then
  fail "$MISSING_LOCKFILE_ACCEPTED"
fi
if [[ -f "$ROOT/infra/terraform/compute/.terraform.lock.hcl" ]]; then
  "$resolver" compute-shared-dev >/dev/null
elif "$resolver" compute-shared-dev >/dev/null 2>&1; then
  fail "$MISSING_LOCKFILE_ACCEPTED"
fi
if [[ -f "$ROOT/infra/terraform/ecr/.terraform.lock.hcl" ]]; then
  "$resolver" ecr-shared-dev >/dev/null
elif "$resolver" ecr-shared-dev >/dev/null 2>&1; then
  fail "$MISSING_LOCKFILE_ACCEPTED"
fi
if [[ -f "$ROOT/infra/terraform/securityhub-import/.terraform.lock.hcl" ]]; then
  "$resolver" securityhub-import-shared-dev >/dev/null
elif "$resolver" securityhub-import-shared-dev >/dev/null 2>&1; then
  fail "$MISSING_LOCKFILE_ACCEPTED"
fi
if [[ -f "$ROOT/infra/terraform/developer-access/.terraform.lock.hcl" ]]; then
  "$resolver" developer-access-shared-dev >/dev/null
elif "$resolver" developer-access-shared-dev >/dev/null 2>&1; then
  fail "$MISSING_LOCKFILE_ACCEPTED"
fi
if "$resolver" ../escape >/dev/null 2>&1; then fail "path traversal accepted"; fi
if "$resolver" unknown >/dev/null 2>&1; then fail "unknown component accepted"; fi
# The catalogue flag has to actually reach the dispatch refusal, not just sit in
# the JSON. These two must refuse a destroy operation for as long as they exist.
if "$resolver" state-backend destroy >/dev/null 2>&1; then
  fail "destroy dispatch accepted for state-backend"
fi
if "$resolver" iam-policy-management-shared-dev destroy >/dev/null 2>&1; then
  fail "destroy dispatch accepted for iam-policy-management-shared-dev"
fi
