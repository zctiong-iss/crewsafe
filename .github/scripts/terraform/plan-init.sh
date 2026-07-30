#!/usr/bin/env bash
set -euo pipefail
strategy="${1:?backend strategy}"
bucket="${2:?bucket}"
region="${3:?region}"
state_key="${4:?state key}"
account_alias="${5:?account alias}"
mode="$("$GITHUB_WORKSPACE/.github/scripts/terraform/inspect-state-bucket.sh" "$bucket" "$account_alias" "$region")"
if [[ "$mode" != bootstrap && "$mode" != managed ]]; then
  echo "::error::Backend inspection returned an invalid mode." >&2
  exit 1
fi
mkdir -p .backend
printf '%s\n' "$mode" >.backend/mode
if [[ "$strategy" == self-bootstrap && "$mode" == bootstrap ]]; then
  terraform init -input=false -lockfile=readonly
elif [[ "$strategy" == self-bootstrap && "$mode" == managed ]]; then
  "$GITHUB_WORKSPACE/.github/scripts/terraform/write-backend-config.sh" "$bucket" "$region" "$state_key"
  terraform init -input=false -lockfile=readonly -reconfigure -backend-config=.backend/state.s3.tfbackend
elif [[ "$strategy" == remote && "$mode" == managed ]]; then
  "$GITHUB_WORKSPACE/.github/scripts/terraform/write-backend-config.sh" \
    "$bucket" "$region" "$state_key" .backend/state.s3.tfbackend .backend/backend.generated.tf
  terraform init -input=false -lockfile=readonly -reconfigure -backend-config=.backend/state.s3.tfbackend
else
  echo "::error::Remote components require the managed SCRUM-155 backend." >&2
  exit 1
fi
