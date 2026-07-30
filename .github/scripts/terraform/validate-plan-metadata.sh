#!/usr/bin/env bash
set -euo pipefail

metadata_file="${1:?metadata file is required}"
expected_alias="${2:?expected alias is required}"
expected_run_id="${3:?expected run ID is required}"
plan_file="${4:-plan.tfplan}"
lock_file="${5:-infra/terraform/bootstrap/state/.terraform.lock.hcl}"
expected_component="${6:-state-backend}"
expected_operation="${7:-apply}"
expected_run_attempt="${8:-1}"
expected_account_id="${9:?expected account ID is required}"
expected_region="${10:?expected Region is required}"

catalog_entry="$(jq -cer --arg component "$expected_component" \
  '.components[$component] // empty' .github/terraform/components.json)" || {
  echo "::error::Reviewed plan component is no longer catalogued." >&2
  exit 1
}
expected_root="$(jq -r .root <<<"$catalog_entry")"
expected_backend_strategy="$(jq -r .backend_strategy <<<"$catalog_entry")"
expected_state_key="$(jq -r .state_key <<<"$catalog_entry")"
expected_jira_key="$(jq -r .jira_key <<<"$catalog_entry")"

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

if ! jq -e \
  --arg alias_name "$expected_alias" \
  --arg run_id "$expected_run_id" \
  --arg component "$expected_component" \
  --arg operation "$expected_operation" \
  --arg run_attempt "$expected_run_attempt" \
  --arg account_id "$expected_account_id" \
  --arg region "$expected_region" \
  --arg root "$expected_root" \
  --arg backend_strategy "$expected_backend_strategy" \
  --arg state_key "$expected_state_key" \
  --arg jira_key "$expected_jira_key" '
  .schema_version == 2
  and .source_workflow == "terraform-plan.yml"
  and .terraform_component == $component
  and .operation == $operation
  and .account_alias == $alias_name
  and .account_id == $account_id
  and .region == $region
  and .root == $root
  and .backend_strategy == $backend_strategy
  and .state_key == $state_key
  and .jira_key == $jira_key
  and (.commit | test("^[0-9a-f]{40}$"))
  and (.plan_sha256 | test("^[0-9a-f]{64}$"))
  and (.lock_sha256 | test("^[0-9a-f]{64}$"))
  and (.catalog_sha256 | test("^[0-9a-f]{64}$"))
  and (.plan_run_id | tostring) == $run_id
  and (.plan_run_attempt | tostring) == $run_attempt
  and (.plan_actor | type == "string" and length > 0)
  and (.created_at | fromdateiso8601 | type == "number")
' "$metadata_file" >/dev/null; then
  echo "::error::Plan metadata is malformed or targets a different operation." >&2
  exit 1
fi

created_epoch="$(jq -r '.created_at | fromdateiso8601' "$metadata_file")"
now_epoch="$(date -u +%s)"
age_seconds=$((now_epoch - created_epoch))
if (( age_seconds < -300 || age_seconds > 86400 )); then
  echo "::error::The reviewed plan is expired or has an invalid timestamp." >&2
  exit 1
fi

expected_plan_hash="$(jq -r '.plan_sha256' "$metadata_file")"
actual_plan_hash="$(sha256_file "$plan_file")"
if [[ "$actual_plan_hash" != "$expected_plan_hash" ]]; then
  echo "::error::Saved plan checksum mismatch." >&2
  exit 1
fi

expected_lock_hash="$(jq -r '.lock_sha256' "$metadata_file")"
actual_lock_hash="$(sha256_file "$lock_file")"
if [[ "$actual_lock_hash" != "$expected_lock_hash" ]]; then
  echo "::error::Terraform dependency lock checksum mismatch." >&2
  exit 1
fi

expected_catalog_hash="$(jq -r '.catalog_sha256' "$metadata_file")"
actual_catalog_hash="$(sha256_file .github/terraform/components.json)"
if [[ "$actual_catalog_hash" != "$expected_catalog_hash" ]]; then
  echo "::error::Terraform component catalog checksum mismatch." >&2
  exit 1
fi

if [[ "$(git rev-parse HEAD)" != "$(jq -r '.commit' "$metadata_file")" ]]; then
  echo "::error::Checked-out commit differs from the reviewed plan." >&2
  exit 1
fi
