#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
registry='{"alice":{"account_id":"123456789012","region":"ap-southeast-1","plan_role_arn":"arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformPlanRole","apply_role_arn":"arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformApplyRole"}}'
CREWSAFE_AWS_ACCOUNTS_JSON="$registry" "$ROOT/.github/scripts/terraform/resolve-terraform-account.sh" alice >/dev/null
if CREWSAFE_AWS_ACCOUNTS_JSON="$registry" "$ROOT/.github/scripts/terraform/resolve-terraform-account.sh" unknown >/dev/null 2>&1; then exit 1; fi
for invalid in \
  "$(jq '.alice.region = "us-east-1"' <<<"$registry")" \
  "$(jq '.alice.plan_role_arn = "arn:aws:iam::999999999999:role/CrewSafeGitHubTerraformPlanRole"' <<<"$registry")" \
  "$(jq '.alice.plan_role_arn = "not-an-arn"' <<<"$registry")" \
  "$(jq '.alice.apply_role_arn = .alice.plan_role_arn' <<<"$registry")"; do
  if CREWSAFE_AWS_ACCOUNTS_JSON="$invalid" \
    "$ROOT/.github/scripts/terraform/resolve-terraform-account.sh" alice >/dev/null 2>&1; then
    echo "unsafe account or OIDC role registry entry was accepted" >&2
    exit 1
  fi
done
grep -Fq '^repo:[A-Za-z0-9_.-]+@[0-9]+/[A-Za-z0-9_.-]+@[0-9]+:ref:refs/heads/main$' \
  "$ROOT/infra/terraform/cognito/variables.tf"
if grep -Fq '^repo:[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+:ref:refs/heads/main$' \
  "$ROOT/infra/terraform/cognito/variables.tf"; then
  echo "legacy name-only GitHub OIDC subject remains accepted" >&2
  exit 1
fi
if grep -Fq 'endswith(var.github_oidc_main_subject' "$ROOT/infra/terraform/cognito/variables.tf"; then
  exit 1
fi
if grep -Fq 'strcontains(var.github_oidc_main_subject' "$ROOT/infra/terraform/cognito/variables.tf"; then
  exit 1
fi
grep -Fq 'EXPECTED_OIDC_SUBJECT: ${{ vars.CREWSAFE_GITHUB_OIDC_MAIN_SUBJECT }}' \
  "$ROOT/.github/workflows/terraform-apply.yml"
grep -Fq '"$EXPECTED_OIDC_SUBJECT"' "$ROOT/.github/workflows/terraform-apply.yml"
