#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/helpers/test-helpers.sh"

resolver="$ROOT/.github/scripts/terraform/resolve-component.sh"
fixtures="$ROOT/.github/scripts/terraform/tests/fixtures/components"
synthetic_root="$ROOT/infra/terraform/synthetic-contract"
lock="$synthetic_root/.terraform.lock.hcl"
versions="$synthetic_root/versions.tf"
backend="$synthetic_root/backend.tf"
outside="$(mktemp -d)"
symlink_path="$ROOT/infra/terraform/synthetic-link"

cleanup() {
  rm -f "$lock" "$versions" "$backend" "$symlink_path" "$outside/.terraform.lock.hcl" \
    "$outside/versions.tf" "$outside/backend.tf"
  rmdir "$synthetic_root" 2>/dev/null || true
  rmdir "$outside" 2>/dev/null || true
}
trap cleanup EXIT
mkdir -p "$synthetic_root"
touch "$lock"
printf 'terraform {}\n' >"$versions"
printf 'terraform { backend "s3" {} }\n' >"$backend"
touch "$outside/.terraform.lock.hcl" "$outside/versions.tf" "$outside/backend.tf"
ln -s "$outside" "$symlink_path"

CREWSAFE_TEST_MODE=1 \
CREWSAFE_TERRAFORM_COMPONENT_CATALOG="$fixtures/synthetic-valid.json" \
  "$resolver" synthetic-contract >/dev/null

if CREWSAFE_TEST_MODE=1 \
  CREWSAFE_TERRAFORM_COMPONENT_CATALOG="$fixtures/synthetic-valid.json" \
  "$resolver" cognito-shared-dev >/dev/null 2>&1; then
  fail "an unregistered root was accepted"
fi

for workflow in terraform-validate.yml terraform-plan.yml terraform-apply.yml; do
  if rg -q 'synthetic-contract' "$ROOT/.github/workflows/$workflow"; then
    fail "$workflow hard-codes the synthetic component"
  fi
done

if CREWSAFE_TEST_MODE=1 \
  CREWSAFE_TERRAFORM_COMPONENT_CATALOG="$fixtures/symlink-escape.json" \
  "$resolver" symlink-escape >/dev/null 2>&1; then
  fail "a symlink escape was accepted"
fi

if CREWSAFE_TEST_MODE=1 \
  CREWSAFE_TERRAFORM_COMPONENT_CATALOG="$fixtures/nested-module.json" \
  "$resolver" nested-module >/dev/null 2>&1; then
  fail "a nested module was accepted as a deployable root"
fi

for fixture in command-like.json duplicate-state-key.json; do
  if CREWSAFE_TEST_MODE=1 \
    CREWSAFE_TERRAFORM_COMPONENT_CATALOG="$fixtures/$fixture" \
    "$resolver" one >/dev/null 2>&1; then
    fail "$fixture was accepted"
  fi
done

if CREWSAFE_TEST_MODE=1 \
  CREWSAFE_TERRAFORM_COMPONENT_CATALOG="$fixtures/synthetic-valid.json" \
  "$resolver" synthetic-contract destroy >/dev/null 2>&1; then
  fail "unapproved synthetic destroy was accepted"
fi
