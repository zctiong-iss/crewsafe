#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"

"$ROOT/.github/scripts/terraform/tests/test-component-catalog.sh"
"$ROOT/.github/scripts/terraform/tests/test-workflow-guards.sh"
"$ROOT/.github/scripts/terraform/tests/test-account-and-oidc-guards.sh"
"$ROOT/.github/scripts/terraform/tests/test-plan-metadata.sh"
"$ROOT/.github/scripts/terraform/tests/test-cognito-iam-policies.sh"
"$ROOT/.github/scripts/terraform/tests/test-component-extension.sh"
"$ROOT/.github/scripts/terraform/tests/test-cognito-deployment-verification.sh"
"$ROOT/.github/scripts/terraform/tests/test-backend-mode-propagation.sh"
"$ROOT/.github/scripts/terraform/tests/test-compute-source-guard.sh"
"$ROOT/.github/scripts/terraform/tests/test-iam-policy-bootstrap.sh"

[[ ! -e "$ROOT/.github/workflows/terraform-state-plan.yml" ]]
[[ ! -e "$ROOT/.github/workflows/terraform-state-apply.yml" ]]
[[ ! -e "$ROOT/.github/workflows/terraform-state-validate.yml" ]]
legacy_root='infra/aws/cognito'"-staging"
managed_user='aws_cognito_'"user\""
if grep -ERn "$legacy_root|$managed_user" "$ROOT/infra" "$ROOT/.github"; then
  exit 1
fi
echo "Terraform CI guards passed"
