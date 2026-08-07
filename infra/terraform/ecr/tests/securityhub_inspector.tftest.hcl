# SCRUM-274 mocked contract tests.
#
# These tests intentionally never call AWS. Terraform Validation runs them
# with mock_provider so the account, region, resource, filter, and permission
# contracts are reviewed before any approved apply.

mock_provider "aws" {}

override_data {
  target = data.aws_caller_identity.current
  values = { account_id = "123456789012" }
}

variables {
  expected_account_id      = "123456789012"
  account_alias            = "shared-dev"
  aws_region               = "ap-southeast-1"
  github_oidc_main_subject = "repo:owner@267492605/crewsafe@1310783821:ref:refs/heads/main"
}

run "rejects_malformed_account_id" {
  command = plan
  variables {
    expected_account_id = "12345"
  }
  expect_failures = [var.expected_account_id]
}

run "rejects_non_approved_region" {
  command = plan
  variables {
    aws_region = "us-east-1"
  }
  expect_failures = [var.aws_region]
}

run "rejects_mismatched_account" {
  command = plan
  variables {
    expected_account_id = "999999999999"
  }
  expect_failures = [
    aws_ecr_repository.backend,
    aws_ecr_repository.web,
    aws_securityhub_account.mvp,
  ]
}

run "securityhub_inspector_contract" {
  command = apply

  assert {
    condition     = aws_securityhub_account.mvp.enable_default_standards == false
    error_message = "Security Hub must be enabled without default standards managed by this component."
  }

  assert {
    condition     = toset(aws_inspector2_enabler.ecr.resource_types) == toset(["ECR"])
    error_message = "Inspector must be enabled only for ECR resources."
  }

  assert {
    condition     = toset(aws_inspector2_enabler.ecr.account_ids) == toset(["123456789012"])
    error_message = "Inspector enablement must be pinned to the approved caller account."
  }

  assert {
    condition     = aws_ecr_registry_scanning_configuration.enhanced.scan_type == "ENHANCED"
    error_message = "The registry must use Inspector enhanced scanning."
  }

  assert {
    condition     = length(aws_ecr_registry_scanning_configuration.enhanced.rule) == 1
    error_message = "The registry must have one reviewed enhanced-scanning rule."
  }

  assert {
    condition     = aws_ecr_registry_scanning_configuration.enhanced.rule[0].scan_frequency == "CONTINUOUS_SCAN"
    error_message = "ECR findings must remain continuously scanned."
  }

  assert {
    condition = toset([
      for f in aws_ecr_registry_scanning_configuration.enhanced.rule[0].repository_filter :
      f.filter
    ]) == toset(["crewsafe/backend", "crewsafe/web"])
    error_message = "Continuous enhanced scanning must cover exactly the two CrewSafe repositories."
  }

  assert {
    condition = alltrue([
      for f in aws_ecr_registry_scanning_configuration.enhanced.rule[0].repository_filter :
      f.filter_type == "WILDCARD"
    ])
    error_message = "Repository filters must use the provider's WILDCARD filter type."
  }
}

run "insight_contract" {
  command = apply

  assert {
    condition     = aws_securityhub_insight.ecr_active_critical_high.name == "CrewSafe ECR Active Critical and High"
    error_message = "The Security Hub Insight name must be stable and identifiable."
  }

  assert {
    condition     = aws_securityhub_insight.ecr_active_critical_high.group_by_attribute == "ResourceId"
    error_message = "Findings must group by resource identity so repository and image digest remain triageable."
  }

  assert {
    condition = contains([
      for f in aws_securityhub_insight.ecr_active_critical_high.filters[0].product_arn :
      f.value
    ], "arn:aws:securityhub:ap-southeast-1::product/aws/inspector")
    error_message = "The Insight must be restricted to the Inspector product in ap-southeast-1."
  }

  assert {
    condition = contains([
      for f in aws_securityhub_insight.ecr_active_critical_high.filters[0].resource_type :
      f.value
    ], "AwsEcrContainerImage")
    error_message = "The Insight must contain only ECR container image findings."
  }

  assert {
    condition = toset([
      for f in aws_securityhub_insight.ecr_active_critical_high.filters[0].record_state :
      f.value
    ]) == toset(["ACTIVE"])
    error_message = "The Insight must show active findings."
  }

  assert {
    condition = toset([
      for f in aws_securityhub_insight.ecr_active_critical_high.filters[0].workflow_status :
      f.value
    ]) == toset(["NEW", "NOTIFIED"])
    error_message = "The Insight must show only actionable NEW or NOTIFIED findings."
  }

  assert {
    condition = toset([
      for f in aws_securityhub_insight.ecr_active_critical_high.filters[0].severity_label :
      f.value
    ]) == toset(["CRITICAL", "HIGH"])
    error_message = "The Insight must include only Critical and High findings."
  }
}
