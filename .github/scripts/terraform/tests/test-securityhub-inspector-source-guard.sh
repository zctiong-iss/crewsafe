#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/helpers/test-helpers.sh"

main_tf="infra/terraform/ecr/main.tf"
outputs_tf="infra/terraform/ecr/outputs.tf"
apply_policy="infra/terraform/ecr/iam/apply-role-policy.json"
plan_policy="infra/terraform/ecr/iam/plan-role-policy.json"
contract_test="infra/terraform/ecr/tests/securityhub_inspector.tftest.hcl"

for path in "$main_tf" "$outputs_tf" "$apply_policy" "$plan_policy" "$contract_test"; do
  assert_file "$path"
done

assert_contains "$main_tf" 'resource "aws_securityhub_account" "mvp"'
assert_contains "$main_tf" 'enable_default_standards = false'
assert_contains "$main_tf" 'resource "aws_inspector2_enabler" "ecr"'
assert_contains "$main_tf" 'resource_types = ["ECR"]'
assert_contains "$main_tf" 'resource "aws_ecr_registry_scanning_configuration" "enhanced"'
assert_contains "$main_tf" 'scan_type = "ENHANCED"'
assert_contains "$main_tf" 'scan_frequency = "CONTINUOUS_SCAN"'
assert_contains "$main_tf" 'filter      = "crewsafe/backend"'
assert_contains "$main_tf" 'filter      = "crewsafe/web"'
assert_not_contains "$main_tf" 'filter      = "*"'
assert_contains "$main_tf" 'resource "aws_securityhub_insight" "ecr_active_critical_high"'
assert_contains "$main_tf" 'group_by_attribute = "ResourceId"'
assert_contains "$main_tf" 'AwsEcrContainerImage'
assert_contains "$main_tf" 'CRITICAL'
assert_contains "$main_tf" 'HIGH'
assert_contains "$main_tf" 'ACTIVE'
assert_contains "$main_tf" 'NEW'
assert_contains "$main_tf" 'NOTIFIED'
assert_contains "$main_tf" 'depends_on = [aws_securityhub_account.mvp]'
assert_contains "$main_tf" 'data.aws_caller_identity.current.account_id == var.expected_account_id'

# SCRUM-274 must remain a narrow extension of the existing ECR component. It
# must not become an importer, remediation engine, or second state component.
assert_not_contains "$main_tf" "BatchImportFindings"
assert_not_contains "$main_tf" "securityhub:BatchImportFindings"
assert_not_contains "$main_tf" "jira"
assert_not_contains "$main_tf" "securitylake"
assert_not_contains "$main_tf" "grafana"
assert_not_contains "$main_tf" "cross_account"
assert_not_contains "$main_tf" "cross_region"

assert_contains "$outputs_tf" 'output "securityhub_ecr_insight_arn"'
assert_contains "$outputs_tf" 'aws_securityhub_insight.ecr_active_critical_high.arn'

for sid in ManageSecurityHubAccount CreateSecurityHubServiceLinkedRole UpdateSecurityHubConfiguration CreateInspectorServiceLinkedRole ManageSecurityHubInsight ManageInspectorEcrEnablement ManageEcrEnhancedScanning; do
  jq -e --arg sid "$sid" '[.Statement[] | select(.Sid == $sid)] | length == 1' "$ROOT/$apply_policy" >/dev/null ||
    fail "$apply_policy missing exactly one $sid statement"
done
jq -e '[.Statement[] | select(.Sid == "ManageEcrEnhancedScanning") | .Action | sort | . == ["ecr:DescribeRegistry","ecr:PutRegistryScanningConfiguration"]]' "$ROOT/$apply_policy" >/dev/null
jq -e '[.Statement[] | select(.Sid == "ManageInspectorEcrEnablement") | .Action | sort | . == ["inspector2:BatchGetAccountStatus","inspector2:Disable","inspector2:Enable"]]' "$ROOT/$apply_policy" >/dev/null
jq -e '[.Statement[] | select(.Sid == "ManageSecurityHubAccount") | .Action | sort | . == ["securityhub:DescribeHub","securityhub:DisableSecurityHub","securityhub:EnableSecurityHub"]]' "$ROOT/$apply_policy" >/dev/null
jq -e '[.Statement[] | select(.Sid == "CreateSecurityHubServiceLinkedRole" and ((.Action | sort) == ["iam:CreateServiceLinkedRole"]) and .Resource == "arn:aws:iam::<ACCOUNT_ID>:role/aws-service-role/securityhub.amazonaws.com/AWSServiceRoleForSecurityHub" and .Condition.StringLike["iam:AWSServiceName"] == "securityhub.amazonaws.com")] | length == 1' "$ROOT/$apply_policy" >/dev/null
jq -e '[.Statement[] | select(.Sid == "UpdateSecurityHubConfiguration" and ((.Action | sort) == ["securityhub:UpdateSecurityHubConfiguration"]) and .Resource == "arn:aws:securityhub:ap-southeast-1:<ACCOUNT_ID>:hub/default")] | length == 1' "$ROOT/$apply_policy" >/dev/null
jq -e '[.Statement[] | select(.Sid == "CreateInspectorServiceLinkedRole" and ((.Action | sort) == ["iam:CreateServiceLinkedRole"]) and .Resource == "arn:aws:iam::<ACCOUNT_ID>:role/aws-service-role/inspector2.amazonaws.com/AWSServiceRoleForAmazonInspector2" and .Condition.StringLike["iam:AWSServiceName"] == "inspector2.amazonaws.com")] | length == 1' "$ROOT/$apply_policy" >/dev/null
jq -e '[.Statement[] | select(.Sid == "ManageSecurityHubInsight") | .Action | sort | . == ["securityhub:CreateInsight","securityhub:DeleteInsight","securityhub:GetInsight","securityhub:ListInsights","securityhub:UpdateInsight"]]' "$ROOT/$apply_policy" >/dev/null

jq -e '[.Statement[] | select(.Sid == "ReadSecurityHubInspector") | .Action | sort | . == ["ecr:DescribeRegistry","inspector2:BatchGetAccountStatus","inspector2:ListCoverage","securityhub:DescribeHub","securityhub:GetInsight","securityhub:ListInsights"]]' "$ROOT/$plan_policy" >/dev/null

# No raw ASFF or finding payload is stored or imported by the Terraform layer.
assert_not_contains "$apply_policy" "BatchImportFindings"
assert_not_contains "$plan_policy" "BatchImportFindings"
