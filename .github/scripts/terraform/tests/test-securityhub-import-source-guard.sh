#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/helpers/test-helpers.sh"

root="infra/terraform/securityhub-import"
main_tf="$root/main.tf"
variables_tf="$root/variables.tf"
outputs_tf="$root/outputs.tf"
backend_tf="$root/backend.tf"
versions_tf="$root/versions.tf"
contract="$root/tests/securityhub_import.tftest.hcl"
for path in "$main_tf" "$variables_tf" "$outputs_tf" "$backend_tf" "$versions_tf" "$contract"; do
  assert_file "$path"
done

assert_contains "$backend_tf" 'backend "s3"'
assert_contains "$main_tf" 'aws_iam_role'
assert_contains "$main_tf" 'BatchImportFindings'
assert_contains "$main_tf" 'securityhub:GetFindings'
assert_contains "$main_tf" 'sts.amazonaws.com'
assert_contains "$variables_tf" 'refs/heads/main'
assert_contains "$variables_tf" 'ap-southeast-1'
assert_contains "$main_tf" 'data.aws_caller_identity.current.account_id == var.expected_account_id'
assert_contains "$outputs_tf" 'sonar_securityhub_import_role_arn'
assert_not_contains "$main_tf" 'securityhub:*'
assert_not_contains "$main_tf" 'BatchUpdateFindings'
assert_not_contains "$main_tf" 'remediation'

importer=".github/scripts/security/import-sonar-securityhub.sh"
assert_file "$importer"
assert_contains "$importer" 'sonar_origin="https://sonarcloud.io"'
assert_contains "$importer" 'CONFIG_ORIGIN_DENIED'
assert_contains "$importer" '--connect-timeout 2'
assert_contains "$importer" '--max-time 3'
assert_contains "$importer" "SourceUrl:\$source_url"
assert_contains "$importer" "source_url=\"\${sonar_origin}/project/issues?id=\${project_key}&open=\${issue_key}\""

iam_main="infra/terraform/iam-policy-management/main.tf"
assert_contains "$iam_main" '"securityhub-import"'
assert_contains "$iam_main" 'length(local.policy_bindings) == 14'
for kind in plan apply; do
  template="infra/terraform/iam-policy-management/policies/securityhub-import/${kind}.json.tftpl"
  assert_file "$template"
  # shellcheck disable=SC2153 # test helper defines ROOT for repository-relative assertions.
  jq empty "$ROOT/$template"
done

catalog="$ROOT/.github/terraform/components.json"
jq -e '.components["securityhub-import-shared-dev"] | .jira_key == "SCRUM-284" and .root == "infra/terraform/securityhub-import" and .backend_strategy == "remote" and .allow_destroy == false and .execution_role_family == "standard"' "$catalog" >/dev/null
echo "PASS: Sonar Security Hub importer source boundary is static and least-privilege."
