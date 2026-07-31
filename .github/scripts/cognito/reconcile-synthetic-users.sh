#!/usr/bin/env bash
set -euo pipefail

account_alias="${1:-}"
operation="${2:-}"
synthetic_key="${3:-}"
pool="${4:-}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
aws_cli="${AWS_CLI:-aws}"
registry="${CREWSAFE_AWS_ACCOUNTS_JSON:-}"
shared_config="${CREWSAFE_SHARED_COGNITO_JSON:-}"
expected_checksum="${EXPECTED_MANIFEST_CHECKSUM:-}"
run_id="${GITHUB_RUN_ID:-local-test}"
source_sha="${GITHUB_SHA:-local-test}"
actor="${GITHUB_ACTOR:-local-test}"

on_error() {
  local status=$?
  trap - ERR
  echo "::error::Synthetic operation stopped; run $run_id requires documented recovery before retry." >&2
  exit "$status"
}
trap on_error ERR

case "$operation" in
  reconcile-synthetic|rotate-synthetic|enable-synthetic|disable-synthetic) ;;
  *) echo "::error::Unsupported synthetic lifecycle operation." >&2; exit 1 ;;
esac

selected="$(
  CREWSAFE_AWS_ACCOUNTS_JSON="$registry" \
  CREWSAFE_SHARED_COGNITO_JSON="$shared_config" \
    "$root/.github/scripts/cognito/resolve-synthetic-users.sh" \
      "$account_alias" "$synthetic_key"
)"
checksum="$(jq -r .manifest_checksum <<<"$selected")"
if [[ -n "$expected_checksum" && "$checksum" != "$expected_checksum" ]]; then
  echo "::error::Synthetic manifest changed after authorization." >&2
  exit 1
fi

account_id="$(jq -er --arg alias "$account_alias" '.[$alias].account_id' <<<"$registry")"
region="$(jq -er --arg alias "$account_alias" '.[$alias].region' <<<"$registry")"
configured_pool="$(
  CREWSAFE_SHARED_COGNITO_JSON="$shared_config" \
    "$root/.github/scripts/cognito/resolve-shared-config.sh" "$account_alias" |
    jq -r .user_pool_id
)"
[[ "$region" == ap-southeast-1 && "$pool" == "$configured_pool" ]] || {
  echo "::error::Selected Region or Cognito pool does not match reviewed configuration." >&2
  exit 1
}
caller_account="$(
  "$aws_cli" sts get-caller-identity --query Account --output text |
    tr -d '"'
)"
[[ "$caller_account" == "$account_id" ]] || {
  echo "::error::OIDC role belongs to the wrong AWS account." >&2
  exit 1
}

result() {
  local key="$1"
  local sub="$2"
  local status="$3"
  jq -cn \
    --arg account_alias "$account_alias" \
    --arg source_sha "$source_sha" \
    --arg manifest_checksum "$checksum" \
    --arg operation "$operation" \
    --arg key "$key" \
    --arg cognito_sub "$sub" \
    --arg result "$status" \
    --arg run_id "$run_id" \
    --arg actor "$actor" \
    --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{
      schema_version:1,
      account_alias:$account_alias,
      source_sha:$source_sha,
      manifest_checksum:$manifest_checksum,
      operation:$operation,
      key:$key,
      cognito_sub:$cognito_sub,
      result:$result,
      actor:$actor,
      run_id:$run_id,
      timestamp:$timestamp
    }'
}

while IFS= read -r declaration; do
  key="$(jq -r .key <<<"$declaration")"
  username="$(jq -r .username <<<"$declaration")"
  desired_status="$(jq -r .desired_status <<<"$declaration")"
  declared_sub="$(jq -r '.cognito_sub // empty' <<<"$declaration")"

  error_file="$(mktemp)"
  if live="$("$aws_cli" cognito-idp admin-get-user \
      --user-pool-id "$pool" --username "$username" --output json \
      2>"$error_file")"; then
    exists=true
  elif grep -q 'UserNotFoundException' "$error_file"; then
    exists=false
    live='{}'
  else
    echo "::error::Cognito identity inspection failed; run $run_id requires recovery." >&2
    rm -f "$error_file"
    exit 1
  fi
  rm -f "$error_file"

  if [[ "$exists" == false ]]; then
    [[ "$operation" == reconcile-synthetic ]] || {
      echo "::error::Synthetic lifecycle target does not exist." >&2
      exit 1
    }
    if [[ "$desired_status" == disabled ]]; then
      result "$key" "" unchanged
      continue
    fi
    [[ -z "$declared_sub" ]] || {
      echo "::error::Bound synthetic identity is missing from Cognito." >&2
      exit 1
    }

    password="$("$aws_cli" secretsmanager get-random-password \
      --password-length 24 \
      --require-each-included-type \
      --exclude-characters '\"' \
      --query RandomPassword --output text)"
    secret_name="crewsafe/${account_alias}/cognito/synthetic/${key}"
    "$aws_cli" secretsmanager create-secret \
      --name "$secret_name" \
      --description "CrewSafe synthetic test credential" \
      --secret-string "$password" \
      --tags \
        Key=ManagedBy,Value=crewsafe \
        Key=Purpose,Value=synthetic-test \
        Key=AccountAlias,Value="$account_alias" \
        Key=SyntheticKey,Value="$key" >/dev/null
    created="$("$aws_cli" cognito-idp admin-create-user \
      --user-pool-id "$pool" \
      --username "$username" \
      --temporary-password "$password" \
      --message-action SUPPRESS \
      --user-attributes \
        Name=email,Value="$username" \
        Name=email_verified,Value=true \
        Name=name,Value="$(jq -r .display_name <<<"$declaration")" \
      --output json)"
    created_sub="$(
      jq -er '[.User.Attributes[] | select(.Name == "sub") | .Value][0]' \
        <<<"$created"
    )"
    "$aws_cli" cognito-idp admin-set-user-password \
      --user-pool-id "$pool" --username "$username" \
      --password "$password" --permanent >/dev/null
    "$aws_cli" cognito-idp admin-add-user-to-group \
      --user-pool-id "$pool" --username "$username" \
      --group-name synthetic-test-users >/dev/null
    unset password
    result "$key" "$created_sub" created-awaiting-binding
    continue
  fi

  live_username="$(
    jq -r '[.UserAttributes[]? | select(.Name == "email") | .Value][0] // empty' \
      <<<"$live"
  )"
  live_sub="$(
    jq -r '[.UserAttributes[]? | select(.Name == "sub") | .Value][0] // empty' \
      <<<"$live"
  )"
  live_enabled="$(jq -r '.Enabled // false' <<<"$live")"
  [[ "$live_username" == "$username" && "$username" == *@synthetic.crewsafe.invalid && -n "$live_sub" ]] || {
    echo "::error::Existing Cognito identity is not a safe synthetic match." >&2
    exit 1
  }
  if [[ -n "$declared_sub" && "$declared_sub" != "$live_sub" ]]; then
    echo "::error::Immutable Cognito subject conflict." >&2
    exit 1
  fi

  groups="$("$aws_cli" cognito-idp admin-list-groups-for-user \
    --user-pool-id "$pool" --username "$username" --output json)"
  jq -e '
    [.Groups[]?.GroupName] as $groups
    | ($groups - ["synthetic-test-users"] | length) == 0
  ' <<<"$groups" >/dev/null || {
    echo "::error::Synthetic identity has an unrelated Cognito group." >&2
    exit 1
  }
  if [[ -z "$declared_sub" ]]; then
    jq -e 'any(.Groups[]?; .GroupName == "synthetic-test-users")' \
      <<<"$groups" >/dev/null || {
      echo "::error::Unbound synthetic identity is missing its reviewed classification; recovery is required." >&2
      exit 1
    }
    result "$key" "$live_sub" created-awaiting-binding
    continue
  fi

  case "$operation" in
    reconcile-synthetic)
      if ! jq -e 'any(.Groups[]?; .GroupName == "synthetic-test-users")' \
        <<<"$groups" >/dev/null; then
        "$aws_cli" cognito-idp admin-add-user-to-group \
          --user-pool-id "$pool" --username "$username" \
          --group-name synthetic-test-users >/dev/null
        result "$key" "$live_sub" updated
      elif [[ "$desired_status" == enabled && "$live_enabled" != true ]] \
        || [[ "$desired_status" == disabled && "$live_enabled" == true ]]; then
        result "$key" "$live_sub" status-mismatch
      elif [[ "$desired_status" == disabled ]]; then
        result "$key" "$live_sub" disabled
      else
        result "$key" "$live_sub" unchanged
      fi
      ;;
    rotate-synthetic)
      [[ "$desired_status" == enabled ]] || {
        echo "::error::Disabled synthetic identity cannot rotate." >&2
        exit 1
      }
      [[ "$live_enabled" == true ]] || {
        echo "::error::Disabled Cognito identity cannot rotate." >&2
        exit 1
      }
      password="$("$aws_cli" secretsmanager get-random-password \
        --password-length 24 --require-each-included-type \
        --exclude-characters '\"' --query RandomPassword --output text)"
      "$aws_cli" secretsmanager put-secret-value \
        --secret-id "crewsafe/${account_alias}/cognito/synthetic/${key}" \
        --secret-string "$password" >/dev/null
      "$aws_cli" cognito-idp admin-set-user-password \
        --user-pool-id "$pool" --username "$username" \
        --password "$password" --permanent >/dev/null
      unset password
      "$aws_cli" cognito-idp admin-user-global-sign-out \
        --user-pool-id "$pool" --username "$username" >/dev/null
      result "$key" "$live_sub" updated
      ;;
    enable-synthetic)
      [[ "$desired_status" == enabled ]] || {
        echo "::error::Manifest must review enabled status before enablement." >&2
        exit 1
      }
      if [[ "$live_enabled" == true ]]; then
        result "$key" "$live_sub" unchanged
        continue
      fi
      "$aws_cli" cognito-idp admin-enable-user \
        --user-pool-id "$pool" --username "$username" >/dev/null
      result "$key" "$live_sub" enabled
      ;;
    disable-synthetic)
      [[ "$desired_status" == disabled ]] || {
        echo "::error::Manifest must review disabled status before disablement." >&2
        exit 1
      }
      if [[ "$live_enabled" != true ]]; then
        result "$key" "$live_sub" disabled
        continue
      fi
      "$aws_cli" cognito-idp admin-disable-user \
        --user-pool-id "$pool" --username "$username" >/dev/null
      "$aws_cli" cognito-idp admin-user-global-sign-out \
        --user-pool-id "$pool" --username "$username" >/dev/null
      result "$key" "$live_sub" disabled
      ;;
  esac
done < <(jq -c '.users[]' <<<"$selected")

if [[ "$operation" == reconcile-synthetic && "$synthetic_key" == all ]]; then
  live_users="$("$aws_cli" cognito-idp list-users \
    --user-pool-id "$pool" --output json)"
  while IFS= read -r unmanaged; do
    unmanaged_username="$(jq -r .username <<<"$unmanaged")"
    unmanaged_sub="$(jq -r .sub <<<"$unmanaged")"
    result "$unmanaged_username" "$unmanaged_sub" unmanaged
  done < <(
    jq -c --argjson selected "$selected" '
      [.Users[]?
        | {
            username: ([.Attributes[]? | select(.Name == "email") | .Value][0] // ""),
            sub: ([.Attributes[]? | select(.Name == "sub") | .Value][0] // "")
          }
        | select(.username | endswith("@synthetic.crewsafe.invalid"))
        | select(.sub != "")
        | select(.username as $username
            | any($selected.users[]?; .username == $username) | not)
      ][]
    ' <<<"$live_users"
  )
fi
