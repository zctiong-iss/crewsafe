#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/helpers/test-helpers.sh"

main_tf="infra/terraform/ecr/main.tf"
outputs_tf="infra/terraform/ecr/outputs.tf"
variables_tf="infra/terraform/ecr/variables.tf"
tests_tf="infra/terraform/ecr/tests/ecr.tftest.hcl"
apply_policy="infra/terraform/ecr/iam/apply-role-policy.json"
runbook="docs/runbooks/SCRUM-253-ecr-registry-web.md"
catalog=".github/terraform/components.json"

assert_file "$main_tf"
assert_file "$outputs_tf"
assert_file "$variables_tf"
assert_file "$tests_tf"
assert_file "$apply_policy"
assert_file "$runbook"

# The web registry stays inside the existing component and state boundary.
assert_contains "$main_tf" 'web_repository_name = "crewsafe/web"'
assert_contains "$main_tf" 'resource "aws_ecr_repository" "web"'
assert_contains "$main_tf" 'resource "aws_ecr_lifecycle_policy" "web"'
assert_contains "$main_tf" 'resource "aws_iam_role" "web_ecr_push"'
assert_contains "$main_tf" 'resource "aws_iam_role_policy" "web_ecr_push"'
assert_contains "$outputs_tf" 'output "web_repository_url"'
assert_contains "$outputs_tf" 'output "web_repository_arn"'
assert_contains "$outputs_tf" 'output "web_push_role_arn"'
assert_contains "$main_tf" 'data.aws_caller_identity.current.account_id == var.expected_account_id'
assert_contains "$variables_tf" 'condition     = can(regex("^[0-9]{12}$", var.expected_account_id))'
assert_contains "$variables_tf" 'condition     = var.aws_region == "ap-southeast-1"'
assert_contains "$variables_tf" 'condition     = can(regex("^repo:[A-Za-z0-9_.-]+@[0-9]+/[A-Za-z0-9_.-]+@[0-9]+:ref:refs/heads/main$", var.github_oidc_main_subject))'
assert_contains "$tests_tf" 'target = aws_ecr_repository.web'
assert_contains "$tests_tf" 'target = aws_iam_role.web_ecr_push'

# Existing backend addresses and contracts must remain additive, not migrated.
assert_contains "$main_tf" 'resource "aws_ecr_repository" "backend"'
assert_contains "$main_tf" 'resource "aws_iam_role" "ecr_push"'
assert_contains "$outputs_tf" 'output "repository_url"'
assert_contains "$outputs_tf" 'output "repository_arn"'
assert_contains "$outputs_tf" 'output "push_role_arn"'
jq -e '
  .components["ecr-shared-dev"].root == "infra/terraform/ecr" and
  .components["ecr-shared-dev"].state_key == "crewsafe/ecr/shared-dev.tfstate" and
  .components["ecr-shared-dev"].allow_destroy == false
' "$ROOT/$catalog" >/dev/null
assert_contains "$runbook" 'Never run Terraform or make AWS mutations from a workstation.'

web_repo_arn='arn:aws:ecr:ap-southeast-1:<ACCOUNT_ID>:repository/crewsafe/web'
web_role_arn='arn:aws:iam::<ACCOUNT_ID>:role/crewsafe-shared-dev-ecr-web-push'

# Manual apply permissions must be exact and independently scoped.
jq -e --arg repo "$web_repo_arn" '
  any(.Statement[]; .Sid == "ManageWebEcrRepository" and .Resource == $repo)
' "$ROOT/$apply_policy" >/dev/null
jq -e --arg role "$web_role_arn" '
  any(.Statement[]; .Sid == "ManageWebPushRoleIdentity" and .Resource == $role)
' "$ROOT/$apply_policy" >/dev/null
if jq -e '
  any(.Statement[]; .Sid == "ManageWebEcrRepository" and .Resource == "*") or
  any(.Statement[]; .Sid == "ManageWebPushRoleIdentity" and .Resource == "*")
' "$ROOT/$apply_policy" >/dev/null; then
  fail "web ECR administration permissions must not use wildcard resources"
fi

# The future runtime receives a pull-only contract; publication and deletion
# remain outside its permission boundary.
assert_contains "$runbook" 'web_repository_arn'
assert_contains "$runbook" 'ecr:GetDownloadUrlForLayer'
assert_contains "$runbook" 'must not receive push, delete, lifecycle, repository-management, or Terraform permissions'
assert_not_contains "$runbook" 'ecr:PutImage'
assert_not_contains "$runbook" 'ecr:DeleteRepository'
assert_contains "$runbook" '4 to add, 0 to change, 0 to destroy'
