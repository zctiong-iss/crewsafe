#!/usr/bin/env bash
set -euo pipefail
strategy="${1:?strategy}"
bucket="${2:?bucket}"
region="${3:?region}"
state_key="${4:?state key}"
component="${5:?component}"
plan_run_id="${6:?plan run ID}"
plan_attempt="${7:?plan attempt}"
mode="$(<.backend/mode)"
recovery_key=""
if [[ "$strategy" == self-bootstrap && "$mode" == bootstrap ]]; then
  [[ -s terraform.tfstate ]]
  recovery_key="crewsafe/bootstrap/recovery/${GITHUB_RUN_ID}.tfstate"
  aws s3api put-object --bucket "$bucket" --key "$recovery_key" --body terraform.tfstate \
    --server-side-encryption AES256 >/dev/null
  "$GITHUB_WORKSPACE/.github/scripts/terraform/write-backend-config.sh" "$bucket" "$region" "$state_key"
  terraform init -input=false -lockfile=readonly -migrate-state -force-copy \
    -backend-config=.backend/state.s3.tfbackend
  aws s3api head-object --bucket "$bucket" --key "$state_key" >/dev/null
fi
marker="$RUNNER_TEMP/applied-plan.json"
jq -n --arg component "$component" --arg run "$plan_run_id" --arg attempt "$plan_attempt" \
  --arg actor "$GITHUB_ACTOR" --arg applied_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{component:$component,plan_run_id:$run,plan_run_attempt:$attempt,applied_by:$actor,applied_at:$applied_at}' >"$marker"
aws s3api put-object --bucket "$bucket" \
  --key "crewsafe/applied-plans/${component}/${plan_run_id}-${plan_attempt}.json" \
  --body "$marker" --server-side-encryption AES256 >/dev/null
[[ -z "$recovery_key" ]] || aws s3api delete-object --bucket "$bucket" --key "$recovery_key" >/dev/null
