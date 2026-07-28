#!/usr/bin/env bash
set -euo pipefail

bucket="${1:?bucket is required}"
account_alias="${2:?account alias is required}"
expected_account_id="${3:?expected account ID is required}"
region="${4:?region is required}"

actual_account_id="$(aws sts get-caller-identity --query Account --output text)"
if [[ "$actual_account_id" != "$expected_account_id" ]]; then
  echo "::error::Authenticated AWS account changed during verification." >&2
  exit 1
fi

versioning="$(aws s3api get-bucket-versioning --bucket "$bucket" --query Status --output text)"
[[ "$versioning" == "Enabled" ]] || {
  echo "::error::S3 versioning is not enabled." >&2
  exit 1
}

encryption="$(aws s3api get-bucket-encryption --bucket "$bucket" --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm' --output text)"
[[ "$encryption" == "AES256" ]] || {
  echo "::error::S3 encryption is not AES256." >&2
  exit 1
}

ownership="$(aws s3api get-bucket-ownership-controls --bucket "$bucket" --query 'OwnershipControls.Rules[0].ObjectOwnership' --output text)"
[[ "$ownership" == "BucketOwnerEnforced" ]] || {
  echo "::error::S3 ownership is not BucketOwnerEnforced." >&2
  exit 1
}

public_block="$(aws s3api get-public-access-block --bucket "$bucket" --output json)"
jq -e '
  .PublicAccessBlockConfiguration
  | .BlockPublicAcls == true
    and .IgnorePublicAcls == true
    and .BlockPublicPolicy == true
    and .RestrictPublicBuckets == true
' <<<"$public_block" >/dev/null || {
  echo "::error::One or more S3 public-access block controls are disabled." >&2
  exit 1
}

policy="$(aws s3api get-bucket-policy --bucket "$bucket" --query Policy --output text)"
jq -e '
  .Statement
  | any(
      .Sid == "DenyInsecureTransport"
      and .Effect == "Deny"
      and .Condition.Bool["aws:SecureTransport"] == "false"
    )
' <<<"$policy" >/dev/null || {
  echo "::error::The bucket policy does not deny non-TLS access." >&2
  exit 1
}

tags="$(aws s3api get-bucket-tagging --bucket "$bucket" --output json)"
jq -e \
  --arg alias_name "$account_alias" '
  (.TagSet | map({key: .Key, value: .Value}) | from_entries)
  | .Project == "CrewSafe"
    and .ManagedBy == "Terraform"
    and .DeploymentAccount == $alias_name
' <<<"$tags" >/dev/null || {
  echo "::error::Required backend tags are missing or incorrect." >&2
  exit 1
}

aws s3api head-object \
  --bucket "$bucket" \
  --key "crewsafe/bootstrap/terraform.tfstate" >/dev/null

actual_region="$(aws s3api get-bucket-location --bucket "$bucket" --query LocationConstraint --output text)"
[[ "$actual_region" == "$region" ]] || {
  echo "::error::State bucket Region mismatch." >&2
  exit 1
}
