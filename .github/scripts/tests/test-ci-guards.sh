#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
resolve_script="$repo_root/.github/scripts/resolve-terraform-account.sh"
metadata_script="$repo_root/.github/scripts/validate-plan-metadata.sh"
backend_script="$repo_root/.github/scripts/write-backend-config.sh"
fixture_dir="$(mktemp -d)"
trap 'rm -rf "$fixture_dir"' EXIT

valid_registry='{
  "member-one": {
    "account_id": "123456789012",
    "region": "ap-southeast-1",
    "plan_role_arn": "arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformPlanRole",
    "apply_role_arn": "arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformApplyRole"
  }
}'

fail_test() {
  echo "FAIL: $1" >&2
  exit 1
}

expect_failure() {
  label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    fail_test "$label unexpectedly succeeded"
  fi
}

resolved="$(CREWSAFE_AWS_ACCOUNTS_JSON="$valid_registry" "$resolve_script" member-one)"
jq -e '
  .account_id == "123456789012"
  and .bucket == "crewsafe-terraform-state-123456789012-ap-southeast-1"
' <<<"$resolved" >/dev/null || fail_test "valid account resolution"

expect_failure "unknown alias" \
  env CREWSAFE_AWS_ACCOUNTS_JSON="$valid_registry" "$resolve_script" missing

mismatched_registry="$(jq -c \
  '.["member-one"].apply_role_arn = "arn:aws:iam::999999999999:role/CrewSafeGitHubTerraformApplyRole"' \
  <<<"$valid_registry")"
expect_failure "cross-account apply role" \
  env CREWSAFE_AWS_ACCOUNTS_JSON="$mismatched_registry" "$resolve_script" member-one

"$backend_script" \
  "crewsafe-terraform-state-123456789012-ap-southeast-1" \
  "ap-southeast-1" \
  "$fixture_dir/backend.tfbackend"
grep -q 'use_lockfile = true' "$fixture_dir/backend.tfbackend" ||
  fail_test "native lockfile configuration"
expect_failure "unexpected backend bucket" \
  "$backend_script" "other-bucket" "ap-southeast-1" "$fixture_dir/rejected.tfbackend"

printf 'saved plan fixture\n' >"$fixture_dir/plan.tfplan"
printf 'dependency lock fixture\n' >"$fixture_dir/.terraform.lock.hcl"

if command -v sha256sum >/dev/null 2>&1; then
  plan_hash="$(sha256sum "$fixture_dir/plan.tfplan" | cut -d' ' -f1)"
  lock_hash="$(sha256sum "$fixture_dir/.terraform.lock.hcl" | cut -d' ' -f1)"
else
  plan_hash="$(shasum -a 256 "$fixture_dir/plan.tfplan" | cut -d' ' -f1)"
  lock_hash="$(shasum -a 256 "$fixture_dir/.terraform.lock.hcl" | cut -d' ' -f1)"
fi

created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
jq -n \
  --argjson schema_version 1 \
  --arg source_workflow "terraform-state-plan.yml" \
  --arg terraform_component "state-backend" \
  --arg account_alias "member-one" \
  --arg account_id "123456789012" \
  --arg region "ap-southeast-1" \
  --arg bucket "crewsafe-terraform-state-123456789012-ap-southeast-1" \
  --arg mode "bootstrap" \
  --arg plan_actor "planner" \
  --arg plan_run_id "1234" \
  --arg commit "1111111111111111111111111111111111111111" \
  --arg terraform_version "1.10.5" \
  --arg lock_sha256 "$lock_hash" \
  --arg plan_sha256 "$plan_hash" \
  --arg created_at "$created_at" \
  '{
    schema_version: $schema_version,
    source_workflow: $source_workflow,
    terraform_component: $terraform_component,
    account_alias: $account_alias,
    account_id: $account_id,
    region: $region,
    bucket: $bucket,
    mode: $mode,
    plan_actor: $plan_actor,
    plan_run_id: $plan_run_id,
    commit: $commit,
    terraform_version: $terraform_version,
    lock_sha256: $lock_sha256,
    plan_sha256: $plan_sha256,
    created_at: $created_at
  }' >"$fixture_dir/metadata.json"

"$metadata_script" \
  "$fixture_dir/metadata.json" member-one 1234 applier \
  "$fixture_dir/plan.tfplan" "$fixture_dir/.terraform.lock.hcl"

expect_failure "same plan and apply actor" \
  "$metadata_script" \
  "$fixture_dir/metadata.json" member-one 1234 PLANNER \
  "$fixture_dir/plan.tfplan" "$fixture_dir/.terraform.lock.hcl"

jq '.created_at = "2020-01-01T00:00:00Z"' \
  "$fixture_dir/metadata.json" >"$fixture_dir/expired.json"
expect_failure "expired plan" \
  "$metadata_script" \
  "$fixture_dir/expired.json" member-one 1234 applier \
  "$fixture_dir/plan.tfplan" "$fixture_dir/.terraform.lock.hcl"

printf 'tampered\n' >>"$fixture_dir/plan.tfplan"
expect_failure "tampered plan" \
  "$metadata_script" \
  "$fixture_dir/metadata.json" member-one 1234 applier \
  "$fixture_dir/plan.tfplan" "$fixture_dir/.terraform.lock.hcl"

echo "CI guard tests passed"
