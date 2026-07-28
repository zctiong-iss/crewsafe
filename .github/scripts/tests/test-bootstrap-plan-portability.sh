#!/usr/bin/env bash
set -euo pipefail

fixture_dir="$(mktemp -d)"
trap 'rm -rf "$fixture_dir"' EXIT

plan_dir="$fixture_dir/plan-runner"
apply_dir="$fixture_dir/apply-runner"
mkdir -p "$plan_dir" "$apply_dir"

for directory in "$plan_dir" "$apply_dir"; do
  printf '%s\n' \
    'terraform {' \
    '  required_version = ">= 1.10, < 2.0"' \
    '}' \
    '' \
    'resource "terraform_data" "bootstrap" {' \
    '  input = "saved-plan-portability"' \
    '}' >"$directory/main.tf"
done

(
  cd "$plan_dir"
  terraform init -input=false
  terraform plan -input=false -out=bootstrap.tfplan
)

cp "$plan_dir/bootstrap.tfplan" "$apply_dir/bootstrap.tfplan"

(
  cd "$apply_dir"
  terraform init -input=false
  terraform apply -input=false -auto-approve bootstrap.tfplan
  terraform show -json |
    jq -e '
      .values.root_module.resources
      | any(
          .address == "terraform_data.bootstrap"
          and .values.input == "saved-plan-portability"
        )
    ' >/dev/null
)

echo "Bootstrap saved-plan portability test passed"
