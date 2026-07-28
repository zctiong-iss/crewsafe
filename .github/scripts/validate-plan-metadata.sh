#!/usr/bin/env bash
set -euo pipefail

metadata_file="${1:?metadata file is required}"
expected_alias="${2:?expected alias is required}"
expected_run_id="${3:?expected run ID is required}"
apply_actor="${4:?apply actor is required}"
plan_file="${5:-plan.tfplan}"
lock_file="${6:-infra/terraform/bootstrap/state/.terraform.lock.hcl}"

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

if ! jq -e \
  --arg alias_name "$expected_alias" \
  --arg run_id "$expected_run_id" '
  .schema_version == 1
  and .source_workflow == "terraform-state-plan.yml"
  and .terraform_component == "state-backend"
  and .account_alias == $alias_name
  and (.account_id | test("^[0-9]{12}$"))
  and .region == "ap-southeast-1"
  and (.bucket == ("crewsafe-terraform-state-" + .account_id + "-" + .region))
  and (.mode == "bootstrap" or .mode == "managed")
  and (.commit | test("^[0-9a-f]{40}$"))
  and (.plan_sha256 | test("^[0-9a-f]{64}$"))
  and (.lock_sha256 | test("^[0-9a-f]{64}$"))
  and (.plan_run_id | tostring) == $run_id
  and (.plan_actor | type == "string" and length > 0)
  and (.created_at | fromdateiso8601 | type == "number")
' "$metadata_file" >/dev/null; then
  echo "::error::Plan metadata is malformed or targets a different operation." >&2
  exit 1
fi

plan_actor="$(jq -r '.plan_actor' "$metadata_file")"
normalized_plan_actor="$(printf '%s' "$plan_actor" | tr '[:upper:]' '[:lower:]')"
normalized_apply_actor="$(printf '%s' "$apply_actor" | tr '[:upper:]' '[:lower:]')"
if [[ "$normalized_plan_actor" == "$normalized_apply_actor" ]]; then
  echo "::error::The apply actor must differ from the plan actor." >&2
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
