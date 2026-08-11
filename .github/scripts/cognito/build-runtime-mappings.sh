#!/usr/bin/env bash
set -euo pipefail

account_alias="${1:-}"
mode="${2:-local}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
case "$mode" in
  local|strict-publication) ;;
  *) echo "Unknown runtime mapping mode." >&2; exit 1 ;;
esac
shared="$(
  "$root/.github/scripts/cognito/resolve-shared-config.sh" "$account_alias"
)"
synthetic="$(
  "$root/.github/scripts/cognito/resolve-synthetic-users.sh" "$account_alias" all
)"

if [[ "$mode" == "strict-publication" ]]; then
  jq -e '
    (.users | type == "array")
    and all(.users[];
      (.cognito_sub | type == "string" and test("^[^@[:space:]]{1,128}$"))
    )
  ' <<<"$synthetic" >/dev/null || {
    echo "Publication mapping requires every selected synthetic identity to have a bound immutable Cognito subject." >&2
    exit 1
  }
fi

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
      | if $mode == "strict-publication" then . else map(select(.cognito_sub != null)) end
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
  ' --arg mode "$mode"
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
  and (
    $mode != "strict-publication"
    or all(.[].cognitoSub;
      type == "string" and test("^[^*@[:space:]]{1,128}$")
    )
  )
' --arg mode "$mode" <<<"$combined" >/dev/null || {
  echo "Combined Cognito application mappings are conflicting or unsafe." >&2
  exit 1
}

jq -c . <<<"$combined"
