mock_provider "aws" {}

run "customer_managed_policy_contract" {
  command = plan

  variables {
    expected_account_id      = "123456789012"
    account_alias            = "alice"
    aws_region               = "ap-southeast-1"
    terraform_plan_role_arn  = "arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformPlanRole"
    terraform_apply_role_arn = "arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformApplyRole"
  }

  override_data {
    target = data.aws_caller_identity.current
    values = { account_id = "123456789012" }
  }

  assert {
    condition     = length(output.policy_bindings) == 12
    error_message = "The IAM policy-management root must expose exactly twelve bindings."
  }

  assert {
    condition = alltrue([
      for binding in values(output.policy_bindings) :
      binding.policy_path == "/crewsafe/terraform/iam-policy-management/"
      && binding.policy_name == "crewsafe-terraform-${binding.component}-${binding.role_kind}-policy"
      && binding.target_role_name == (binding.role_kind == "plan" ? "CrewSafeGitHubTerraformPlanRole" : "CrewSafeGitHubTerraformApplyRole")
      && binding.target_role_arn == (binding.role_kind == "plan" ? "arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformPlanRole" : "arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformApplyRole")
    ])
    error_message = "Every policy must use the deterministic path, name, and normal role target."
  }

  assert {
    condition     = length(output.policy_arns) == 12 && length(output.attachment_keys) == 12
    error_message = "Every customer-managed policy must have one explicit attachment."
  }

}

run "reject_wrong_role_account" {
  command = plan

  variables {
    expected_account_id      = "123456789012"
    account_alias            = "alice"
    aws_region               = "ap-southeast-1"
    terraform_plan_role_arn  = "arn:aws:iam::999999999999:role/CrewSafeGitHubTerraformPlanRole"
    terraform_apply_role_arn = "arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformApplyRole"
  }

  override_data {
    target = data.aws_caller_identity.current
    values = { account_id = "123456789012" }
  }

  expect_failures = [terraform_data.input_validation]
}
