#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
resolver="$ROOT/.github/scripts/cognito/resolve-shared-config.sh"
known_site_codes_file="$ROOT/backend/src/main/resources/cognito/known-site-codes.json"

jq empty "$ROOT/.github/cognito/shared-config.schema.json"

# SCRUM-490 (FR-008, T020/T021): these two JSON Schema docs are not runtime-enforced — nothing
# validates a manifest against them — so nothing but this assertion stops their `site_codes`
# enum from silently drifting from the canonical allowlist both resolvers actually read.
known_sites_json="$(jq -ce . "$known_site_codes_file")"
jq -e --argjson known_sites "$known_sites_json" '
  ."$defs".application_user.properties.site_codes.items.enum == $known_sites
' "$ROOT/.github/cognito/shared-config.schema.json" >/dev/null || {
  echo "shared-config.schema.json site_codes enum has drifted from known-site-codes.json" >&2
  exit 1
}
jq -e --argjson known_sites "$known_sites_json" '
  ."$defs".syntheticUser.properties.site_codes.items.enum == $known_sites
' "$ROOT/.github/cognito/synthetic-users.schema.json" >/dev/null || {
  echo "synthetic-users.schema.json site_codes enum has drifted from known-site-codes.json" >&2
  exit 1
}
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

# SCRUM-490 (T012): a site code outside bishan/campus is accepted once it is declared in the
# canonical allowlist, proving this resolver reads that file rather than a literal — and is
# still rejected against the production allowlist, so the positive-allowlist behavior holds.
riverside="$(jq '.accounts.alice.application_users[0].site_codes = ["riverside"]' <<<"$valid")"
known_sites_with_riverside="$(mktemp)"
trap 'rm -f "$known_sites_with_riverside"' EXIT
printf '["bishan", "campus", "riverside"]' > "$known_sites_with_riverside"

CREWSAFE_SHARED_COGNITO_JSON="$riverside" \
KNOWN_SITE_CODES_FILE="$known_sites_with_riverside" \
  "$resolver" alice >/dev/null || {
  echo "a site code newly declared in known-site-codes.json was rejected" >&2
  exit 1
}
if CREWSAFE_SHARED_COGNITO_JSON="$riverside" "$resolver" alice >/dev/null 2>&1; then
  echo "an undeclared site code was accepted against the production allowlist" >&2
  exit 1
fi
