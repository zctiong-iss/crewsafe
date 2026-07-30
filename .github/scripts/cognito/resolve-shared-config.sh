#!/usr/bin/env bash
set -euo pipefail

account_alias="${1:-}"
config="${CREWSAFE_SHARED_COGNITO_JSON:-}"

[[ "$account_alias" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || {
  echo "A valid account alias is required." >&2
  exit 1
}
[[ -n "$config" ]] || {
  echo "Shared Cognito configuration is unavailable." >&2
  exit 1
}

jq -cer --arg alias "$account_alias" '
  select(type == "object" and .schema_version == 1)
  | select((keys | sort) == ["accounts", "schema_version"])
  | .accounts[$alias]
  | select(type == "object")
  | select((keys | sort) == [
      "application_users",
      "cli_client_id",
      "groups",
      "hosted_ui_url",
      "issuer_uri",
      "jwks_uri",
      "mobile_client_id",
      "region",
      "user_pool_id",
      "web_client_id"
    ])
  | select(.region == "ap-southeast-1")
  | select(.user_pool_id | test("^ap-southeast-1_[A-Za-z0-9]+$"))
  | select(.issuer_uri == ("https://cognito-idp.ap-southeast-1.amazonaws.com/" + .user_pool_id))
  | select(.jwks_uri == (.issuer_uri + "/.well-known/jwks.json"))
  | select(.hosted_ui_url | test("^https://[a-z0-9-]+\\.auth\\.ap-southeast-1\\.amazoncognito\\.com$"))
  | select(all(.web_client_id, .mobile_client_id, .cli_client_id;
      type == "string" and test("^[A-Za-z0-9]+$")))
  | select(.groups == ["developers", "synthetic-test-users"])
  | select(.application_users | type == "array")
  | select([.application_users[].username] | length == (unique | length))
  | select([.application_users[].cognito_sub] | length == (unique | length))
  | select(all(.application_users[];
      (keys | sort) == [
        "cognito_sub",
        "display_name",
        "identity_kind",
        "role",
        "site_codes",
        "username"
      ]
      and (.username | test("^[a-z0-9]+([._-][a-z0-9]+)*$"))
      and (.cognito_sub | test("^[^@[:space:]]{1,128}$"))
      and (.display_name | type == "string" and length >= 1 and length <= 100)
      and (.role | IN("WORKER", "SUPERVISOR", "SAFETY_MANAGER", "ADMIN"))
      and (.identity_kind | IN("developer", "synthetic-test"))
      and (.site_codes | type == "array"
        and length == (unique | length)
        and all(.[]; test("^[a-z0-9]+(-[a-z0-9]+)*$")))
    ))
' <<<"$config" || {
  echo "Shared Cognito configuration is missing, stale, or unsafe." >&2
  exit 1
}
