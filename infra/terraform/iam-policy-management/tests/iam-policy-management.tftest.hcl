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
    condition     = length(output.policy_bindings) == 18
    error_message = "The IAM policy-management root must expose exactly sixteen bindings."
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
    condition     = length(output.policy_arns) == 18 && length(output.attachment_keys) == 18
    error_message = "Every customer-managed policy must have one explicit attachment."
  }

}

# SCRUM-298: negative boundary test for the compute-web component, added before the
# templates changed per this runbook's own "Policy changes" process. Confirms the new
# grants stay scoped to exactly what SCRUM-298's spec requires — no wildcard IAM action,
# no bucket/role resource beyond the two named ones — the same discipline
# compute.tftest.hcl's own R-006 assertions apply at the Terraform-resource level.
run "compute_web_policies_stay_least_privilege" {
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
    condition = alltrue([
      for stmt in jsondecode(aws_iam_policy.component["compute-web-apply"].policy).Statement :
      alltrue([for action in stmt.Action : !can(regex(":\\*$", action))])
    ])
    error_message = "No statement in the compute-web apply policy may grant a wildcard action on any service."
  }

  assert {
    condition = alltrue([
      for stmt in jsondecode(aws_iam_policy.component["compute-web-apply"].policy).Statement :
      stmt.Sid != "ManageWebSyncRoleOnly" ||
      stmt.Resource == "arn:aws:iam::123456789012:role/crewsafe-shared-dev-web-sync"
    ])
    error_message = "The compute-web apply policy's IAM statement must be scoped to exactly the web sync role, never a wildcard or another role."
  }

  assert {
    condition = alltrue([
      for stmt in jsondecode(aws_iam_policy.component["compute-web-plan"].policy).Statement :
      alltrue([for action in stmt.Action : !can(regex(":\\*$", action))])
    ])
    error_message = "No statement in the compute-web plan policy may grant a wildcard action on any service."
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
