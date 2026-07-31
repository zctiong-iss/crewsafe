#!/usr/bin/env bash
set -euo pipefail

account_alias="${1:-}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
shared="$(
  "$root/.github/scripts/cognito/resolve-shared-config.sh" "$account_alias"
)"
synthetic="$(
  "$root/.github/scripts/cognito/resolve-synthetic-users.sh" "$account_alias" all
)"

combined="$(
  jq -cn --argjson shared "$shared" --argjson synthetic "$synthetic" '
    (
      $shared.application_users
      | map({
          username,
          cognitoSub:.cognito_sub,
          displayName:.display_name,
          role,
          siteCodes:.site_codes,
          identityKind:.identity_kind,
          desiredStatus:"preserve"
        })
    )
    +
    (
      $synthetic.users
      | map(select(.cognito_sub != null))
      | map({
          username,
          cognitoSub:.cognito_sub,
          displayName:.display_name,
          role,
          siteCodes:.site_codes,
          identityKind:"synthetic-test",
          desiredStatus:.desired_status
        })
    )
  '
)"

jq -e '
  ([.[].username] | length == (unique | length))
  and ([.[].cognitoSub] | length == (unique | length))
  and all(.[];
    .cognitoSub != null
    and (.identityKind | IN("developer", "synthetic-test"))
    and (
      (.identityKind == "developer" and .desiredStatus == "preserve")
      or
      (.identityKind == "synthetic-test"
        and (.desiredStatus | IN("enabled", "disabled")))
    )
  )
' <<<"$combined" >/dev/null || {
  echo "Combined Cognito application mappings are conflicting or unsafe." >&2
  exit 1
}

jq -c . <<<"$combined"
