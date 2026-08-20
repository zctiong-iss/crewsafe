#!/usr/bin/env bash
set -euo pipefail

account_alias="${1:-}"
synthetic_key="${2:-all}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
manifest="${SYNTHETIC_USERS_FILE:-$root/.github/cognito/synthetic-users.yml}"
registry="${CREWSAFE_AWS_ACCOUNTS_JSON:-}"
shared_config="${CREWSAFE_SHARED_COGNITO_JSON:-}"
known_site_codes_file="${KNOWN_SITE_CODES_FILE:-$root/backend/src/main/resources/cognito/known-site-codes.json}"

[[ -f "$manifest" ]] || {
  echo "::error::Synthetic user manifest is unavailable." >&2
  exit 1
}
jq -e 'type == "object" and length > 0' <<<"$registry" >/dev/null || {
  echo "::error::AWS account registry is unavailable." >&2
  exit 1
}
# SCRUM-490: the single canonical allowlist (FR-001/FR-006) shared with DemoDataSeeder — see
# specs/057-synthetic-site-allowlist/research.md for why it lives under backend/ rather than
# .github/ (the backend Docker build context cannot reach anything outside backend/).
known_sites="$(jq -ce 'select(type == "array" and length > 0 and all(.[]; type == "string"))' \
    "$known_site_codes_file")" || {
  echo "::error::Known site codes file is missing, unreadable, or malformed." >&2
  exit 1
}

decoded="$(
  ruby -ryaml -rjson -e '
    value = YAML.safe_load(
      File.read(ARGV.fetch(0)),
      permitted_classes: [],
      permitted_symbols: [],
      aliases: false
    )
    STDOUT.write(JSON.generate(value))
  ' "$manifest"
)" || {
  echo "::error::Synthetic user manifest contains unsafe or malformed YAML." >&2
  exit 1
}

manifest_diagnostic() {
  jq -r --argjson known_sites "$known_sites" '
    def allowed_fields: [
      "cognito_sub", "desired_status", "display_name", "group",
      "key", "role", "site_codes", "username"
    ];
    if type != "object" then
      "top level must be an object"
    elif (keys | sort) != ["accounts", "schema_version"] then
      "top level has missing or additional fields"
    elif .schema_version != 1 then
      "schema_version must equal 1"
    elif (.accounts | type) != "object" or (.accounts | length) < 1 then
      "accounts must be a non-empty object"
    elif any(.accounts | keys[]; test("^[a-z][a-z0-9-]{1,31}$") | not) then
      "account alias contains an unsafe identifier"
    elif any(.accounts[]; type != "array" or length > 20) then
      "account declaration must be an array of at most 20 users"
    elif any(.accounts[][];
      type != "object" or (keys | sort) != allowed_fields) then
      "synthetic user has missing or additional fields"
    elif ([.. | strings] | any(.[];
      test("password|temporary.?code|secret.?value|client.?secret|(access|refresh|id).?token|aws[_-]?(access|secret)|BEGIN [A-Z ]+PRIVATE KEY"; "i")
    )) then
      "credential-like content is forbidden"
    elif any(.accounts[][];
      (.key | type) != "string"
      or (.key | length) < 3 or (.key | length) > 40
      or (.key | test("^[a-z][a-z0-9]*(-[a-z0-9]+)*$") | not)) then
      "key contains an unsafe identifier"
    elif any(.accounts[][];
      (.username | type) != "string"
      or (.username | test("^[a-z0-9][a-z0-9._+-]*@synthetic\\.crewsafe\\.invalid$") | not)) then
      "username must use the reserved synthetic namespace"
    elif any(.accounts[][];
      (.display_name | type) != "string"
      or (.display_name | startswith("Synthetic ") | not)) then
      "display_name must identify a synthetic user"
    elif any(.accounts[][]; (.role | IN("WORKER", "SUPERVISOR", "SAFETY_MANAGER") | not)) then
      "role is unsupported"
    elif any(.accounts[][];
      (.site_codes | type) != "array"
      or (.site_codes | length) < 1
      or any(.site_codes[]; IN($known_sites[]) | not)) then
      "site_codes contain an unsupported or empty assignment"
    elif any(.accounts[][]; .group != "synthetic-test-users") then
      "group must equal synthetic-test-users"
    elif any(.accounts[][]; (.desired_status | IN("enabled", "disabled") | not)) then
      "desired_status must be enabled or disabled"
    elif any(.accounts[][]; .cognito_sub != null and (
      (.cognito_sub | type) != "string"
      or (.cognito_sub | test("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$") | not)
    )) then
      "cognito_sub must be null or a lowercase UUID"
    elif any(.accounts[];
      ([.[].key] | length != (unique | length))
      or ([.[].username] | length != (unique | length))
      or ([.[].cognito_sub | select(. != null)] | length != (unique | length))) then
      "key, username, and bound cognito_sub values must be unique per account"
    else
      "account must include worker, supervisor, and safety-manager personas"
    end
  ' <<<"$decoded"
}

jq -e --argjson known_sites "$known_sites" '
  type == "object"
  and (keys | sort) == ["accounts", "schema_version"]
  and .schema_version == 1
  and (.accounts | type == "object" and length >= 1)
  and all(.accounts | to_entries[];
    (.key | test("^[a-z][a-z0-9-]{1,31}$"))
    and (.value | type == "array" and length <= 20)
    and ([.value[].key] | length == (unique | length))
    and ([.value[].username] | length == (unique | length))
    and ([.value[].cognito_sub | select(. != null)] | length == (unique | length))
    and (if (.value | length) == 0 then true else
      ([.value[].role] | contains(["WORKER", "SUPERVISOR", "SAFETY_MANAGER"]))
    end)
    and all(.value[];
      (keys | sort) == [
        "cognito_sub",
        "desired_status",
        "display_name",
        "group",
        "key",
        "role",
        "site_codes",
        "username"
      ]
      and (.key | type == "string"
        and length >= 3 and length <= 40
        and test("^[a-z][a-z0-9]*(-[a-z0-9]+)*$"))
      and (.username | type == "string" and length <= 128
        and test("^[a-z0-9][a-z0-9._+-]*@synthetic\\.crewsafe\\.invalid$"))
      and (.display_name | type == "string" and length >= 3 and length <= 80
        and startswith("Synthetic "))
      and (.role | IN("WORKER", "SUPERVISOR", "SAFETY_MANAGER"))
      and (.site_codes | type == "array" and length >= 1
        and length == (unique | length)
        and all(.[]; IN($known_sites[])))
      and .group == "synthetic-test-users"
      and (.desired_status | IN("enabled", "disabled"))
      and (.cognito_sub == null or (
        .cognito_sub | type == "string"
        and test("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
      ))
    )
  )
  and ([.. | strings] | all(.[];
    test("password|temporary.?code|secret.?value|client.?secret|(access|refresh|id).?token|aws[_-]?(access|secret)|BEGIN [A-Z ]+PRIVATE KEY"; "i") | not
  ))
' <<<"$decoded" >/dev/null || {
  echo "::error::Synthetic user manifest is unsafe: $(manifest_diagnostic)." >&2
  exit 1
}

jq -e --argjson manifest "$decoded" \
  '(($manifest.accounts | keys) - (keys)) | length == 0' \
  <<<"$registry" >/dev/null || {
  echo "::error::Synthetic user manifest contains an unknown account." >&2
  exit 1
}

if command -v sha256sum >/dev/null 2>&1; then
  checksum="$(printf '%s' "$decoded" | sha256sum | awk '{print $1}')"
else
  checksum="$(printf '%s' "$decoded" | shasum -a 256 | awk '{print $1}')"
fi

if [[ -z "$account_alias" ]]; then
  jq -c --arg checksum "$checksum" '
    {
      schema_version,
      manifest_checksum: $checksum,
      accounts: (.accounts | with_entries(.value = {
        count: (.value | length),
        unbound: ([.value[] | select(.cognito_sub == null)] | length),
        disabled: ([.value[] | select(.desired_status == "disabled")] | length)
      })),
      omission_policy: "report-only"
    }
  ' <<<"$decoded"
  exit 0
fi

[[ "$account_alias" =~ ^[a-z][a-z0-9-]{1,31}$ ]] || {
  echo "::error::Invalid synthetic account alias." >&2
  exit 1
}
[[ "$synthetic_key" == all || "$synthetic_key" =~ ^[a-z][a-z0-9]*(-[a-z0-9]+)*$ ]] || {
  echo "::error::Invalid synthetic user key." >&2
  exit 1
}
if ! jq -e --arg alias "$account_alias" '.accounts | has($alias)' \
  <<<"$decoded" >/dev/null; then
  if [[ "${ALLOW_MISSING_SYNTHETIC_ACCOUNT:-false}" == true \
    && "$synthetic_key" == all ]]; then
    users='[]'
  else
    echo "::error::Synthetic account is not declared." >&2
    exit 1
  fi
else
  users="$(
    jq -c --arg alias "$account_alias" --arg key "$synthetic_key" '
      .accounts[$alias] | if $key == "all" then . else map(select(.key == $key)) end
    ' <<<"$decoded"
  )"
fi

if [[ "$synthetic_key" != all ]] && [[ "$(jq length <<<"$users")" -ne 1 ]]; then
  echo "::error::Synthetic user key is not declared." >&2
  exit 1
fi

if [[ -n "$shared_config" ]]; then
  existing="$(
    CREWSAFE_SHARED_COGNITO_JSON="$shared_config" \
      "$root/.github/scripts/cognito/resolve-shared-config.sh" "$account_alias"
  )"
  jq -e --argjson users "$users" '
    .application_users as $existing
    | all($users[];
        . as $candidate
        | all($existing[];
            .username != $candidate.username
            and ($candidate.cognito_sub == null or .cognito_sub != $candidate.cognito_sub)
        )
      )
  ' <<<"$existing" >/dev/null || {
    echo "::error::Synthetic declaration conflicts with an existing application mapping." >&2
    exit 1
  }
fi

jq -cn \
  --arg account_alias "$account_alias" \
  --arg checksum "$checksum" \
  --argjson users "$users" \
  '{
    schema_version: 1,
    account_alias: $account_alias,
    manifest_checksum: $checksum,
    users: $users,
    omission_policy: "report-only"
  }'
