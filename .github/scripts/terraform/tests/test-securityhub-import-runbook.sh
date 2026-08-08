#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/helpers/test-helpers.sh"

plan="docs/plans/SCRUM-284-sonarcloud-security-hub-findings-plan.md"
runbook="docs/runbooks/SCRUM-284-sonarcloud-security-hub-findings.md"
assert_file "$plan"
assert_file "$runbook"
for text in "Never run Terraform locally" "iam-policy-management-shared-dev" "securityhub-import-shared-dev" "Terraform Validation" "Terraform Plan" "Terraform Apply" "EventBridge" "automatic remediation" "NOT-ACTIVATED" "NOT-VALIDATED" "FAILED_PARTIAL" "60 minutes" "reviewed code revert" "redacted evidence"; do
  assert_contains "$runbook" "$text"
done
assert_contains "$plan" "SCRUM-274"
assert_contains "$plan" "CI-only"
for forbidden in "AWS_SECRET_ACCESS_KEY" "AWS_SESSION_TOKEN" "Authorization:" "BatchImportFindings" "securityhub:BatchImportFindings"; do
  assert_not_contains "$runbook" "$forbidden"
done
echo "PASS: runbook contains the required redacted, CI-only operating controls."
