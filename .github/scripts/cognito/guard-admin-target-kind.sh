#!/usr/bin/env bash
set -euo pipefail

pool="${1:-}"
account_alias="${2:-}"
subject="${3:-}"
operation="${4:-}"
group="${5:-}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
aws_cli="${AWS_CLI:-aws}"

[[ "$pool" =~ ^ap-southeast-1_[A-Za-z0-9]+$ ]] || {
  echo "::error::Invalid Cognito pool for target classification." >&2
  exit 1
}
[[ "$subject" =~ ^[^@[:space:]]{1,128}$ ]] || {
  echo "::error::Invalid immutable Cognito subject." >&2
  exit 1
}
case "$operation" in
  enable|disable|reset-password|global-sign-out|add-to-group|remove-from-group) ;;
  *) echo "::error::Unsupported generic mutation." >&2; exit 1 ;;
esac
if [[ "$operation" == add-to-group || "$operation" == remove-from-group ]]; then
  [[ "$group" == developers ]] || {
    echo "::error::Generic group administration supports developers only; synthetic-test-users is denied." >&2
    exit 1
  }
fi

live="$("$aws_cli" cognito-idp admin-get-user \
  --user-pool-id "$pool" --username "$subject" --output json)"
groups="$("$aws_cli" cognito-idp admin-list-groups-for-user \
  --user-pool-id "$pool" --username "$subject" --output json)"

username="$(
  jq -r '
    ([.UserAttributes[]? | select(.Name == "email") | .Value][0])
    // .Username // empty
  ' <<<"$live"
)"
live_sub="$(
  jq -r '[.UserAttributes[]? | select(.Name == "sub") | .Value][0] // empty' \
    <<<"$live"
)"
[[ -n "$username" && -n "$live_sub" ]] || {
  echo "::error::Cognito target classification was ambiguous." >&2
  exit 1
}
[[ "$live_sub" == "$subject" ]] || {
  echo "::error::Cognito target does not match the requested immutable subject." >&2
  exit 1
}

manifest="$(
  CREWSAFE_SHARED_COGNITO_JSON="" \
  ALLOW_MISSING_SYNTHETIC_ACCOUNT=true \
    "$root/.github/scripts/cognito/resolve-synthetic-users.sh" "$account_alias" all
)"
manifest_signal="$(
  jq -r --arg username "$username" --arg sub "$live_sub" '
    any(.users[]; .username == $username or .cognito_sub == $sub)
  ' <<<"$manifest"
)"
group_signal="$(
  jq -r 'any(.Groups[]?; .GroupName == "synthetic-test-users")' <<<"$groups"
)"
namespace_signal=false
[[ "$username" == *@synthetic.crewsafe.invalid ]] && namespace_signal=true

if [[ "$namespace_signal" == true || "$manifest_signal" == true || "$group_signal" == true ]]; then
  echo "::error::Generic human administration is denied for synthetic identities." >&2
  exit 1
fi

jq -cn --arg classification human --arg subject "$live_sub" \
  '{classification:$classification,subject:$subject}'
