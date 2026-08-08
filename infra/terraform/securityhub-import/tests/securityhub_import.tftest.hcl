# SCRUM-284 contract tests. Terraform Validation executes this with a mocked
# provider; it is deliberately not a workstation command.
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

run "rejects_invalid_account" {
  command = plan
  variables {
    expected_account_id = "123"
  }
  expect_failures = [var.expected_account_id]
}

run "rejects_wrong_region" {
  command = plan
  variables {
    aws_region = "us-east-1"
  }
  expect_failures = [var.aws_region]
}

run "import_role_is_narrow" {
  command = plan
  assert {
    condition     = aws_iam_role.sonar_securityhub_import.name == "crewsafe-shared-dev-sonar-securityhub-import"
    error_message = "The importer must use its own deterministic role."
  }
}
