#!/usr/bin/env bash
set -euo pipefail

bucket="${1:?bucket is required}"
account_alias="${2:?account alias is required}"
region="${3:?region is required}"
error_file="$(mktemp)"
trap 'rm -f "$error_file"' EXIT

if aws s3api head-bucket --bucket "$bucket" 2>"$error_file"; then
  actual_region="$(aws s3api get-bucket-location --bucket "$bucket" --query 'LocationConstraint' --output text)"
  if [[ "$actual_region" != "$region" ]]; then
    echo "::error::Existing state bucket is in an unexpected Region." >&2
    exit 1
  fi

  tags="$(aws s3api get-bucket-tagging --bucket "$bucket" --output json)"
  project="$(jq -r '.TagSet[] | select(.Key == "Project") | .Value' <<<"$tags")"
  managed_by="$(jq -r '.TagSet[] | select(.Key == "ManagedBy") | .Value' <<<"$tags")"
  deployment_account="$(jq -r '.TagSet[] | select(.Key == "DeploymentAccount") | .Value' <<<"$tags")"

  if [[ "$project" != "CrewSafe" || "$managed_by" != "Terraform" || "$deployment_account" != "$account_alias" ]]; then
    echo "::error::Bucket exists but is not recognized as the selected CrewSafe Terraform backend." >&2
    exit 1
  fi

  if ! aws s3api head-object \
    --bucket "$bucket" \
    --key "crewsafe/bootstrap/terraform.tfstate" >/dev/null; then
    echo "::error::Managed bucket has no canonical bootstrap state. Follow the recovery guide." >&2
    exit 1
  fi

  mode="managed"
elif grep -Eqi '(404|Not Found|NoSuchBucket)' "$error_file"; then
  mode="bootstrap"
else
  sed 's/^/::error::/' "$error_file" >&2
  echo "::error::Unable to determine whether the selected state bucket exists." >&2
  exit 1
fi

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  printf 'mode=%s\n' "$mode" >>"$GITHUB_OUTPUT"
else
  printf '%s\n' "$mode"
fi
