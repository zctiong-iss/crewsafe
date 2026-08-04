#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
resolver="$ROOT/.github/scripts/cognito/resolve-shared-config.sh"

jq empty "$ROOT/.github/cognito/shared-config.schema.json"
jq -e '
  ."$defs".application_user.properties.site_codes.items.enum == ["bishan", "campus"]
' "$ROOT/.github/cognito/shared-config.schema.json" >/dev/null
[[ -x "$resolver" ]]
grep -Eq 'CREWSAFE_SHARED_COGNITO_JSON' "$ROOT/run.sh"
grep -Eq 'gh variable get' "$ROOT/run.sh"
# Comments stripped before scanning — a comment NAMING one of these is not a use of it.
# See the longer note in test-runtime-guards.sh, which strips for the same reason.
if sed -E 's/(^|[[:space:]])#.*$//' "$ROOT/run.sh" | grep -n '' \
  | grep -E 'eval|terraform|aws configure'; then
  echo "run.sh uses eval, invokes Terraform, or configures AWS (AGENTS.md §3)." >&2
  exit 1
fi

valid='{
  "schema_version": 1,
  "accounts": {
    "alice": {
      "region": "ap-southeast-1",
      "user_pool_id": "ap-southeast-1_Abc123",
      "issuer_uri": "https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_Abc123",
      "jwks_uri": "https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_Abc123/.well-known/jwks.json",
      "hosted_ui_url": "https://crewsafe-alice.auth.ap-southeast-1.amazoncognito.com",
      "web_client_id": "web123",
      "mobile_client_id": "mobile123",
      "cli_client_id": "cli123",
      "groups": ["developers", "synthetic-test-users"],
      "application_users": [{
        "username": "developer-one",
        "cognito_sub": "00000000-0000-0000-0000-000000000001",
        "display_name": "Developer One",
        "role": "SUPERVISOR",
        "site_codes": ["bishan"],
        "identity_kind": "developer"
      }]
    }
  }
}'

CREWSAFE_SHARED_COGNITO_JSON="$valid" "$resolver" alice >/dev/null
CREWSAFE_SHARED_COGNITO_JSON="$(
  jq '.accounts.alice.application_users = []' <<<"$valid"
)" "$resolver" alice >/dev/null

for invalid in \
  "$(jq '.accounts.alice.region = "us-east-1"' <<<"$valid")" \
  "$(jq '.accounts.alice.application_users[0].cognito_sub = "person@example.com"' <<<"$valid")" \
  "$(jq '.accounts.alice.application_users[0].site_codes = ["jurong"]' <<<"$valid")" \
  "$(jq '.accounts.alice.application_users += [.accounts.alice.application_users[0]]' <<<"$valid")" \
  "$(jq '.accounts.alice.issuer_uri = "https://example.invalid/pool"' <<<"$valid")" \
  "$(jq '.accounts.alice.password = "forbidden"' <<<"$valid")"; do
  if CREWSAFE_SHARED_COGNITO_JSON="$invalid" "$resolver" alice >/dev/null 2>&1; then
    echo "unsafe shared Cognito configuration was accepted" >&2
    exit 1
  fi
done
