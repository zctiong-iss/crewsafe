#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/helpers/synthetic-test-helpers.sh"

workflow="$TEST_ROOT/.github/workflows/cognito-user-administration.yml"
grep -Fq "if: github.ref == 'refs/heads/main'" "$workflow"
# GitHub expression syntax must remain literal in these assertions.
# shellcheck disable=SC2016
grep -Fq 'group: cognito-admin-${{ inputs.target_account_alias }}' "$workflow"
grep -Fq 'cancel-in-progress: false' "$workflow"
# shellcheck disable=SC2016
grep -Fq 'manifest_checksum: ${{ steps.synthetic.outputs.manifest_checksum }}' "$workflow"
# shellcheck disable=SC2016
grep -Fq 'EXPECTED_MANIFEST_CHECKSUM: ${{ needs.authorize.outputs.manifest_checksum }}' "$workflow"
if grep -Eq 'uses: actions/checkout@(main|master|v[0-9])' "$workflow"; then
  fail "Cognito administration workflow uses an unpinned checkout action"
fi

registry='{"alice":{"account_id":"123456789012","region":"ap-southeast-1"},"empty":{"account_id":"210987654321","region":"ap-southeast-1"}}'
fixture="$TEST_ROOT/.github/scripts/cognito/tests/fixtures/synthetic/valid.yml"
shared_base='{
  "schema_version":1,
  "accounts":{
    "alice":{
      "region":"ap-southeast-1",
      "user_pool_id":"ap-southeast-1_Example",
      "issuer_uri":"https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_Example",
      "jwks_uri":"https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_Example/.well-known/jwks.json",
      "hosted_ui_url":"https://crewsafe-example.auth.ap-southeast-1.amazoncognito.com",
      "web_client_id":"web123",
      "mobile_client_id":"mobile123",
      "cli_client_id":"cli123",
      "groups":["developers","synthetic-test-users"],
      "application_users":[]
    }
  }
}'

CREWSAFE_AWS_ACCOUNTS_JSON="$registry" \
CREWSAFE_SHARED_COGNITO_JSON="$shared_base" \
SYNTHETIC_USERS_FILE="$fixture" \
  "$SYNTHETIC_RESOLVER" alice demo-worker >/dev/null

for conflict in \
  "$(jq '.accounts.alice.application_users=[{
    username:"synthetic-worker@synthetic.crewsafe.invalid",
    cognito_sub:"subject-human",
    display_name:"Developer",
    role:"WORKER",
    site_codes:["bishan"],
    identity_kind:"developer"
  }]' <<<"$shared_base")" \
  "$(jq '.accounts.alice.application_users=[{
    username:"developer",
    cognito_sub:"00000000-0000-0000-0000-000000000002",
    display_name:"Developer",
    role:"ADMIN",
    site_codes:["campus"],
    identity_kind:"developer"
  }]' <<<"$shared_base")"; do
  if CREWSAFE_AWS_ACCOUNTS_JSON="$registry" \
    CREWSAFE_SHARED_COGNITO_JSON="$conflict" \
    SYNTHETIC_USERS_FILE="$fixture" \
    "$SYNTHETIC_RESOLVER" alice all >/dev/null 2>&1; then
    fail "application mapping conflict passed preflight"
  fi
done

resolver="$TEST_ROOT/.github/scripts/cognito/resolve-admin-operation.sh"
admins='{"schema_version":1,"accounts":{"alice":["actor"]}}'
base_env=(
  CREWSAFE_AWS_ACCOUNTS_JSON="$registry"
  CREWSAFE_COGNITO_ADMINS_JSON="$admins"
)
env "${base_env[@]}" "$resolver" alice reconcile-synthetic "" "" actor \
  "reconcile-synthetic alice all" all >/dev/null
env "${base_env[@]}" "$resolver" alice rotate-synthetic "" "" actor \
  "rotate-synthetic alice demo-worker" demo-worker >/dev/null

if env "${base_env[@]}" "$resolver" alice disable-synthetic "" "" actor \
  "disable-synthetic alice demo-worker" "" >/dev/null 2>&1; then
  fail "synthetic lifecycle operation accepted a blank key"
fi
if env "${base_env[@]}" "$resolver" alice add-to-group subject-1 \
  synthetic-test-users actor "add-to-group alice subject-1" >/dev/null 2>&1; then
  fail "generic group operation accepted synthetic-test-users"
fi
if env "${base_env[@]}" "$resolver" alice rotate-synthetic "" "" actor \
  "rotate-synthetic alice demo-worker" demo-supervisor >/dev/null 2>&1; then
  fail "mismatched typed confirmation was accepted"
fi

# SCRUM-490 (T011): a site code outside bishan/campus is accepted once it is declared in the
# canonical allowlist — proves the guard reads that file rather than a literal.
known_sites_with_riverside="$(mktemp)"
trap 'rm -f "$known_sites_with_riverside"' EXIT
printf '["bishan", "campus", "riverside"]' > "$known_sites_with_riverside"

riverside_manifest="$(mktemp)"
cat > "$riverside_manifest" <<'YAML'
schema_version: 1
accounts:
  alice:
    - key: demo-riverside
      username: synthetic-riverside@synthetic.crewsafe.invalid
      display_name: Synthetic Riverside Worker
      role: WORKER
      site_codes: [riverside]
      group: synthetic-test-users
      desired_status: enabled
      cognito_sub:
    - key: demo-riverside-supervisor
      username: synthetic-riverside-supervisor@synthetic.crewsafe.invalid
      display_name: Synthetic Riverside Supervisor
      role: SUPERVISOR
      site_codes: [riverside]
      group: synthetic-test-users
      desired_status: enabled
      cognito_sub:
    - key: demo-riverside-safety-manager
      username: synthetic-riverside-safety-manager@synthetic.crewsafe.invalid
      display_name: Synthetic Riverside Safety Manager
      role: SAFETY_MANAGER
      site_codes: [riverside]
      group: synthetic-test-users
      desired_status: enabled
      cognito_sub:
YAML

CREWSAFE_AWS_ACCOUNTS_JSON="$registry" \
CREWSAFE_SHARED_COGNITO_JSON="$shared_base" \
SYNTHETIC_USERS_FILE="$riverside_manifest" \
KNOWN_SITE_CODES_FILE="$known_sites_with_riverside" \
  "$SYNTHETIC_RESOLVER" alice demo-riverside >/dev/null || \
  fail "a site code newly declared in known-site-codes.json was rejected"

# The same manifest is rejected without the allowlist entry — the positive allowlist behavior
# is preserved, only its source changed.
if CREWSAFE_AWS_ACCOUNTS_JSON="$registry" \
  CREWSAFE_SHARED_COGNITO_JSON="$shared_base" \
  SYNTHETIC_USERS_FILE="$riverside_manifest" \
  "$SYNTHETIC_RESOLVER" alice demo-riverside >/dev/null 2>&1; then
  fail "an undeclared site code was accepted against the production allowlist"
fi
rm -f "$riverside_manifest"

printf 'Synthetic reconciliation guards: PASS\n'
