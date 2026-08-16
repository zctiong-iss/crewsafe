#!/usr/bin/env bash
set -euo pipefail
plan="${1:?plan}"
lock="${2:?lock}"
bundle="${3:?bundle}"
mkdir -p "$bundle"
cp "$plan" "$bundle/plan.tfplan"
sha() { local file="$1"; sha256sum "$file" | cut -d' ' -f1; }
jq -n \
  --argjson schema_version 2 --arg source_workflow "terraform-plan.yml" \
  --arg component "$COMPONENT" --arg operation "$OPERATION" --arg root "$ROOT" \
  --arg backend_strategy "$BACKEND_STRATEGY" --arg state_key "$STATE_KEY" \
  --arg jira_key "$JIRA_KEY" --arg account_alias "$ACCOUNT_ALIAS" \
  --arg account_id "$ACCOUNT_ID" --arg region "$AWS_REGION" \
  --arg actor "$GITHUB_ACTOR" --arg run_id "$GITHUB_RUN_ID" \
  --arg run_attempt "$GITHUB_RUN_ATTEMPT" --arg commit "$GITHUB_SHA" \
  --arg plan_sha256 "$(sha "$plan")" --arg lock_sha256 "$(sha "$lock")" \
  --arg catalog_sha256 "$(sha "$GITHUB_WORKSPACE/.github/terraform/components.json")" \
  --arg created_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{schema_version:$schema_version,source_workflow:$source_workflow,terraform_component:$component,
    operation:$operation,root:$root,backend_strategy:$backend_strategy,state_key:$state_key,jira_key:$jira_key,
    account_alias:$account_alias,account_id:$account_id,region:$region,plan_actor:$actor,
    plan_run_id:$run_id,plan_run_attempt:$run_attempt,commit:$commit,plan_sha256:$plan_sha256,
    lock_sha256:$lock_sha256,catalog_sha256:$catalog_sha256,created_at:$created_at}' >"$bundle/metadata.json"
