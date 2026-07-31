#!/usr/bin/env bash
set -euo pipefail
alias_name="${1:-}"
operation="${2:-}"
subject="${3:-}"
group="${4:-}"
actor="${5:-${GITHUB_ACTOR:-}}"
confirmation="${6:-}"
synthetic_key="${7:-}"
actor_lower="$(printf '%s' "$actor" | tr '[:upper:]' '[:lower:]')"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
registry="${CREWSAFE_AWS_ACCOUNTS_JSON:-}"
admins="${CREWSAFE_COGNITO_ADMINS_JSON:-$(<"$root/.github/cognito/admins.json")}"

jq -e 'type == "object" and length > 0' <<<"$registry" >/dev/null || {
  echo "::error::AWS account registry is unavailable." >&2; exit 1;
}
jq -e '
  type == "object"
  and (keys | sort) == ["accounts", "schema_version"]
  and .schema_version == 1
  and (.accounts | type == "object")
  and all(.accounts | to_entries[];
    (.key | test("^[a-z0-9]+(-[a-z0-9]+)*$"))
    and (.value | type == "array")
    and (.value | length == (unique | length))
    and all(.value[]; type == "string" and test("^[a-z0-9][a-z0-9-]{0,37}$"))
  )
' <<<"$admins" >/dev/null || {
  echo "::error::Cognito administrator allowlist is malformed." >&2; exit 1;
}
jq -e --argjson admins "$admins" \
  '(($admins.accounts | keys) - (keys)) | length == 0' \
  <<<"$registry" >/dev/null || {
  echo "::error::Cognito administrator allowlist contains an unknown account." >&2; exit 1;
}
jq -e --arg a "$alias_name" 'has($a)' <<<"$registry" >/dev/null || {
  echo "::error::Unknown account alias." >&2; exit 1;
}
jq -e --arg a "$alias_name" --arg actor "$actor_lower" \
  '.schema_version == 1 and (.accounts[$a] // [] | index($actor) != null)' <<<"$admins" >/dev/null || {
  echo "::error::Actor is not authorized for Cognito administration." >&2; exit 1;
}
case "$operation" in
  inspect|enable|disable|reset-password|global-sign-out|add-to-group|remove-from-group)
    [[ "$subject" =~ ^[^@[:space:]]{1,128}$ ]] || { echo "::error::Use an immutable non-email Cognito sub." >&2; exit 1; }
    [[ -z "$synthetic_key" ]] || exit 1
    ;;
  list-users|list-groups)
    [[ -z "$subject" && -z "$synthetic_key" ]] || exit 1
    ;;
  reconcile-synthetic|rotate-synthetic|enable-synthetic|disable-synthetic)
    [[ -z "$subject" && -z "$group" ]] || exit 1
    [[ "$synthetic_key" =~ ^[a-z][a-z0-9]*(-[a-z0-9]+)*$ || (
      "$operation" == reconcile-synthetic && "$synthetic_key" == all
    ) ]] || {
      echo "::error::A valid synthetic key is required." >&2
      exit 1
    }
    ;;
  *) echo "::error::Unsupported Cognito operation." >&2; exit 1 ;;
esac
case "$operation" in
  add-to-group|remove-from-group)
    [[ "$group" == developers ]] || {
      echo "::error::Unknown Cognito group." >&2; exit 1;
    }
    ;;
  reconcile-synthetic|rotate-synthetic|enable-synthetic|disable-synthetic) ;;
  *) [[ -z "$group" ]] || exit 1 ;;
esac
case "$operation" in
  inspect|list-users|list-groups) ;;
  reconcile-synthetic|rotate-synthetic|enable-synthetic|disable-synthetic)
    expected="${operation} ${alias_name} ${synthetic_key}"
    [[ "$confirmation" == "$expected" ]] || {
      echo "::error::Confirmation must be exactly: $expected" >&2; exit 1;
    }
    ;;
  *)
    expected="${operation} ${alias_name} ${subject}"
    [[ "$confirmation" == "$expected" ]] || {
      echo "::error::Confirmation must be exactly: $expected" >&2; exit 1;
    }
    ;;
esac
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  printf 'operation=%s\nsubject=%s\ngroup=%s\nactor=%s\nsynthetic_key=%s\n' \
    "$operation" "$subject" "$group" "$actor_lower" "$synthetic_key" >>"$GITHUB_OUTPUT"
else
  jq -n --arg operation "$operation" --arg subject "$subject" --arg group "$group" \
    --arg actor "$actor_lower" --arg synthetic_key "$synthetic_key" \
    '{operation:$operation,subject:$subject,group:$group,actor:$actor,synthetic_key:$synthetic_key}'
fi
