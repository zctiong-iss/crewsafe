#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/helpers/test-helpers.sh"

for workflow in terraform-validate.yml terraform-plan.yml terraform-apply.yml; do
  assert_file ".github/workflows/$workflow"
done
[[ "$(find "$ROOT/.github/workflows" -maxdepth 1 -name 'terraform-*.yml' | wc -l | tr -d ' ')" == 3 ]]
assert_contains ".github/workflows/terraform-validate.yml" '"infra/terraform/**"'
assert_not_contains ".github/workflows/terraform-validate.yml" '"docs/**"'
assert_contains ".github/workflows/terraform-plan.yml" "github.ref == 'refs/heads/main'"
assert_contains ".github/workflows/terraform-apply.yml" "github.ref == 'refs/heads/main'"
# GitHub expression syntax must remain literal in these assertions.
# shellcheck disable=SC2016
assert_contains ".github/workflows/terraform-plan.yml" 'terraform-${{ inputs.target_account_alias }}-${{ inputs.terraform_component }}'
# shellcheck disable=SC2016
assert_contains ".github/workflows/terraform-apply.yml" 'terraform-${{ inputs.target_account_alias }}-${{ inputs.terraform_component }}'
assert_contains ".github/workflows/terraform-validate.yml" 'terraform-provider-lock-cognito'
assert_contains ".github/workflows/terraform-validate.yml" 'terraform providers lock'
assert_contains ".github/workflows/terraform-validate.yml" 'Do not execute Terraform locally.'
assert_contains ".github/workflows/terraform-validate.yml" 'needs: lockfiles'
