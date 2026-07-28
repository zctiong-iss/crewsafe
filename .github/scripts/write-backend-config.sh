#!/usr/bin/env bash
set -euo pipefail

bucket="${1:?bucket is required}"
region="${2:?region is required}"
destination="${3:-.backend/state.s3.tfbackend}"
declaration="${4:-backend.generated.tf}"

if [[ ! "$bucket" =~ ^crewsafe-terraform-state-[0-9]{12}-ap-southeast-1$ ]]; then
  echo "::error::Refusing to write backend configuration for an unexpected bucket." >&2
  exit 1
fi

if [[ "$region" != "ap-southeast-1" ]]; then
  echo "::error::Unexpected backend Region." >&2
  exit 1
fi

if [[ "$destination" == "$declaration" ]]; then
  echo "::error::Backend values and declaration must use different files." >&2
  exit 1
fi

mkdir -p "$(dirname "$destination")" "$(dirname "$declaration")"
umask 077
printf 'bucket = "%s"\nkey = "crewsafe/bootstrap/terraform.tfstate"\nregion = "%s"\nencrypt = true\nuse_lockfile = true\n' \
  "$bucket" "$region" >"$destination"
printf 'terraform {\n  backend "s3" {}\n}\n' >"$declaration"
