#!/usr/bin/env bash
set -euo pipefail

component="${1:-}"
operation="${2:-apply}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
catalog="$root/.github/terraform/components.json"
if [[ "${CREWSAFE_TEST_MODE:-0}" == 1 && -n "${CREWSAFE_TERRAFORM_COMPONENT_CATALOG:-}" ]]; then
  catalog="$CREWSAFE_TERRAFORM_COMPONENT_CATALOG"
fi

jq -e '
  type == "object"
  and (keys | sort) == ["components", "schema_version"]
  and .schema_version == 1
  and (.components | type == "object" and length > 0)
  and all(.components | to_entries[];
    (.key | test("^[a-z0-9]+(-[a-z0-9]+)*$"))
    and (.value | type == "object")
    and (.value | keys | sort) == [
      "allow_destroy",
      "backend_strategy",
      "jira_key",
      "root",
      "state_key"
    ]
    and (.value.jira_key | test("^SCRUM-[0-9]+$"))
    and (.value.root | test("^infra/terraform/[a-z0-9][a-z0-9/_-]*$"))
    and (.value.root | contains("..") | not)
    and (.value.backend_strategy | IN("self-bootstrap", "remote"))
    and (.value.state_key | test("^crewsafe/[a-z0-9][a-z0-9/_.-]*\\.tfstate$"))
    and (.value.allow_destroy | type == "boolean")
  )
' "$catalog" >/dev/null || {
  echo "::error::Terraform component catalog is malformed." >&2
  exit 1
}

[[ "$component" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || {
  echo "::error::Invalid Terraform component." >&2; exit 1;
}
[[ "$operation" == apply || "$operation" == destroy ]] || {
  echo "::error::Operation must be apply or destroy." >&2; exit 1;
}

entry="$(jq -cer --arg component "$component" '.components[$component] // empty' "$catalog")" || {
  echo "::error::Unknown Terraform component." >&2; exit 1;
}
component_root="$(jq -r '.root' <<<"$entry")"
state_key="$(jq -r '.state_key' <<<"$entry")"
backend_strategy="$(jq -r '.backend_strategy' <<<"$entry")"
jira_key="$(jq -r '.jira_key' <<<"$entry")"
allow_destroy="$(jq -r '.allow_destroy' <<<"$entry")"

[[ "$component_root" == infra/terraform/* && "$component_root" != *".."* ]] || exit 1
resolved="$(cd "$root/$component_root" 2>/dev/null && pwd -P)" || {
  echo "::error::Component root does not exist." >&2; exit 1;
}
terraform_root="$(cd "$root/infra/terraform" && pwd -P)"
[[ "$resolved/" == "$terraform_root/"* ]] || {
  echo "::error::Component root escapes infra/terraform." >&2; exit 1;
}
[[ -f "$resolved/.terraform.lock.hcl" ]] || {
  echo "::error::Component dependency lockfile is missing." >&2; exit 1;
}
[[ -f "$resolved/versions.tf" ]] || {
  echo "::error::Component root is missing versions.tf." >&2; exit 1;
}
if [[ "$backend_strategy" == remote ]]; then
  [[ -f "$resolved/backend.tf" ]] && grep -Eq 'backend[[:space:]]+"s3"' "$resolved/backend.tf" || {
    echo "::error::Remote component root is missing its S3 backend declaration." >&2
    exit 1
  }
fi
[[ "$(jq -r '.components[].state_key' "$catalog" | sort | uniq -d | wc -l | tr -d ' ')" == 0 ]] || {
  echo "::error::Duplicate Terraform state key." >&2; exit 1;
}
[[ "$operation" != destroy || "$allow_destroy" == true ]] || {
  echo "::error::Destroy is not approved for this component." >&2; exit 1;
}

emit() {
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf '%s=%s\n' "$1" "$2" >>"$GITHUB_OUTPUT"
  fi
}
emit terraform_component "$component"
emit root "$component_root"
emit backend_strategy "$backend_strategy"
emit state_key "$state_key"
emit jira_key "$jira_key"
emit allow_destroy "$allow_destroy"

if [[ -z "${GITHUB_OUTPUT:-}" ]]; then
  jq -n --arg component "$component" --arg root "$component_root" \
    --arg backend_strategy "$backend_strategy" --arg state_key "$state_key" \
    --arg jira_key "$jira_key" --argjson allow_destroy "$allow_destroy" \
    '{terraform_component:$component,root:$root,backend_strategy:$backend_strategy,state_key:$state_key,jira_key:$jira_key,allow_destroy:$allow_destroy}'
fi
