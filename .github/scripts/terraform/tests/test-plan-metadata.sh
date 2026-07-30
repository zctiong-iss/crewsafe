#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/helpers/test-helpers.sh"

writer="$ROOT/.github/scripts/terraform/write-plan-metadata.sh"
validator="$ROOT/.github/scripts/terraform/validate-plan-metadata.sh"
lock="$ROOT/infra/terraform/bootstrap/state/.terraform.lock.hcl"
tmp="$(mktemp -d)"
plan="$tmp/plan.tfplan"
metadata="$tmp/metadata.json"

cleanup() {
  rm -f "$tmp/plan.tfplan" "$tmp/metadata.json" "$tmp/mutated.json"
  rmdir "$tmp"
}
trap cleanup EXIT
printf 'synthetic reviewed plan\n' >"$plan"

sha() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

jq -n \
  --arg plan_hash "$(sha "$plan")" \
  --arg lock_hash "$(sha "$lock")" \
  --arg catalog_hash "$(sha "$ROOT/.github/terraform/components.json")" \
  --arg commit "$(git -C "$ROOT" rev-parse HEAD)" \
  --arg created_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '
  {
    schema_version:2,
    source_workflow:"terraform-plan.yml",
    terraform_component:"state-backend",
    operation:"apply",
    root:"infra/terraform/bootstrap/state",
    backend_strategy:"self-bootstrap",
    state_key:"crewsafe/bootstrap/terraform.tfstate",
    jira_key:"SCRUM-155",
    account_alias:"alice",
    account_id:"123456789012",
    region:"ap-southeast-1",
    plan_actor:"reviewer",
    plan_run_id:"1234",
    plan_run_attempt:"2",
    commit:$commit,
    plan_sha256:$plan_hash,
    lock_sha256:$lock_hash,
    catalog_sha256:$catalog_hash,
    created_at:$created_at
  }' >"$metadata"

(
  cd "$ROOT"
  "$validator" "$metadata" alice 1234 "$plan" "$lock" \
    state-backend apply 2 123456789012 ap-southeast-1
)

for mutation in \
  '.plan_run_attempt = "3"' \
  '.operation = "destroy"' \
  '.account_id = "999999999999"' \
  '.state_key = "crewsafe/other.tfstate"' \
  '.commit = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"' \
  '.lock_sha256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"' \
  '.catalog_sha256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"' \
  '.plan_sha256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"' \
  '.created_at = "2000-01-01T00:00:00Z"'; do
  jq "$mutation" "$metadata" >"$tmp/mutated.json"
  if (
    cd "$ROOT"
    "$validator" "$tmp/mutated.json" alice 1234 "$plan" "$lock" \
      state-backend apply 2 123456789012 ap-southeast-1
  ) >/dev/null 2>&1; then
    fail "unsafe reviewed-plan metadata mutation was accepted: $mutation"
  fi
done

grep -Eq 'schema_version 2' "$writer"
grep -Eq 'plan_run_attempt' "$writer"
grep -Eq 'catalog_sha256' "$writer"
grep -Eq 'age_seconds.*86400' "$validator"
