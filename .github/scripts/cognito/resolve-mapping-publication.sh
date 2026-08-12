#!/usr/bin/env bash
set -euo pipefail

# Resolve the complete closed contract while the workflow has no AWS credentials.
# The mapping remains process-local; callers receive only its checksum and fixed,
# validated metadata.  Do not add AWS commands to this script.
account_alias="${1:-}"
actor="${2:-${GITHUB_ACTOR:-}}"
confirmation="${3:-}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
workflow_ref="${WORKFLOW_REF:-${GITHUB_REF:-}}"
registry="${CREWSAFE_AWS_ACCOUNTS_JSON:-}"
admins="${CREWSAFE_COGNITO_ADMINS_JSON:-$(<"$root/.github/cognito/admins.json")}" 

[[ "$workflow_ref" == "refs/heads/main" ]] || {
  echo "::error::Mapping publication is permitted only from main." >&2; exit 1;
}
[[ "$account_alias" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || {
  echo "::error::A valid account alias is required." >&2; exit 1;
}
actor="$(printf '%s' "$actor" | tr '[:upper:]' '[:lower:]')"
[[ "$actor" =~ ^[a-z0-9][a-z0-9-]{0,37}$ ]] || {
  echo "::error::A valid workflow actor is required." >&2; exit 1;
}
[[ "$confirmation" == "publish-mapping $account_alias" ]] || {
  echo "::error::Confirmation must be exactly: publish-mapping $account_alias" >&2; exit 1;
}

jq -e 'type == "object" and length > 0' <<<"$registry" >/dev/null || {
  echo "::error::AWS account registry is unavailable." >&2; exit 1;
}
jq -e '
  type == "object" and .schema_version == 1 and (keys | sort) == ["accounts", "schema_version"]
  and (.accounts | type == "object")
  and all(.accounts | to_entries[];
    (.key | test("^[a-z0-9]+(-[a-z0-9]+)*$"))
    and (.value | type == "array" and length == (unique | length))
    and all(.value[]; type == "string" and test("^[a-z0-9][a-z0-9-]{0,37}$"))
  )
' <<<"$admins" >/dev/null || {
  echo "::error::Cognito administrator allowlist is malformed." >&2; exit 1;
}
jq -e --arg alias "$account_alias" --arg actor "$actor" '
  .accounts[$alias] | type == "array" and index($actor) != null
' <<<"$admins" >/dev/null || {
  echo "::error::Actor is not authorized for mapping publication." >&2; exit 1;
}

account="$(GITHUB_OUTPUT='' CREWSAFE_AWS_ACCOUNTS_JSON="$registry" \
  "$root/.github/scripts/terraform/resolve-terraform-account.sh" "$account_alias")"
account_id="$(jq -r .account_id <<<"$account")"
region="$(jq -r .region <<<"$account")"
[[ "$region" == "ap-southeast-1" ]] || { echo "::error::Unexpected AWS region." >&2; exit 1; }

# Both sources validate their own closed schemas. The mapper then applies the
# stricter publication rule across their combined output.
CREWSAFE_SHARED_COGNITO_JSON="${CREWSAFE_SHARED_COGNITO_JSON:-}" \
  "$root/.github/scripts/cognito/resolve-shared-config.sh" "$account_alias" >/dev/null
mapping="$(
  CREWSAFE_AWS_ACCOUNTS_JSON="$registry" \
  CREWSAFE_SHARED_COGNITO_JSON="${CREWSAFE_SHARED_COGNITO_JSON:-}" \
  "$root/.github/scripts/cognito/build-runtime-mappings.sh" "$account_alias" strict-publication
)"
# build-runtime-mappings emits its compact JSON line with a newline. Hash the
# same byte sequence written by the credentialed job, otherwise a correct
# mapping would fail the cross-job checksum comparison solely on line ending.
mapping_checksum="$(printf '%s\n' "$mapping" | shasum -a 256 | awk '{print $1}')"
[[ "$mapping_checksum" =~ ^[0-9a-f]{64}$ ]] || { echo "::error::Mapping checksum is invalid." >&2; exit 1; }

parameter_name="/crewsafe/shared-dev/cognito/demo-users-json"
role_arn="arn:aws:iam::${account_id}:role/crewsafe-shared-dev-cognito-mapping-publish"
[[ "$role_arn" =~ ^arn:aws:iam::[0-9]{12}:role/crewsafe-shared-dev-cognito-mapping-publish$ ]] || {
  echo "::error::Derived publication role is unsafe." >&2; exit 1;
}

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    printf 'account_alias=%s\n' "$account_alias"
    printf 'region=%s\n' "$region"
    printf 'parameter_name=%s\n' "$parameter_name"
    printf 'role_arn=%s\n' "$role_arn"
    printf 'mapping_checksum=%s\n' "$mapping_checksum"
  } >>"$GITHUB_OUTPUT"
else
  jq -n --arg account_alias "$account_alias" --arg region "$region" \
    --arg parameter_name "$parameter_name" --arg role_arn "$role_arn" \
    --arg mapping_checksum "$mapping_checksum" \
    '{account_alias:$account_alias,region:$region,parameter_name:$parameter_name,role_arn:$role_arn,mapping_checksum:$mapping_checksum}'
fi
