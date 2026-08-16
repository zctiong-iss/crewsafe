data "aws_caller_identity" "current" {}

locals {
  components = [
    "cognito",
    "compute",
    "compute-web",
    "database",
    "developer-access",
    "ecr",
    "network",
    "securityhub-import",
    "secrets",
  ]

  role_kinds  = ["plan", "apply"]
  policy_path = "/crewsafe/terraform/iam-policy-management/"

  binding_specs = flatten([
    for component in local.components : [
      for role_kind in local.role_kinds : {
        binding_key      = "${component}-${role_kind}"
        component        = component
        role_kind        = role_kind
        policy_path      = local.policy_path
        policy_name      = "crewsafe-terraform-${component}-${role_kind}-policy"
        policy_template  = "policies/${component}/${role_kind}.json.tftpl"
        target_role_arn  = role_kind == "plan" ? var.terraform_plan_role_arn : var.terraform_apply_role_arn
        target_role_name = role_kind == "plan" ? "CrewSafeGitHubTerraformPlanRole" : "CrewSafeGitHubTerraformApplyRole"
      }
    ]
  ])

  policy_bindings = {
    for binding in local.binding_specs : binding.binding_key => merge(binding, {
      rendered_policy = jsondecode(replace(
        file("${path.module}/${binding.policy_template}"),
        "<ACCOUNT_ID>",
        var.expected_account_id,
      ))
    })
  }
}

resource "terraform_data" "input_validation" {
  input = {
    account_alias            = var.account_alias
    expected_account_id      = var.expected_account_id
    terraform_plan_role_arn  = var.terraform_plan_role_arn
    terraform_apply_role_arn = var.terraform_apply_role_arn
  }

  lifecycle {
    precondition {
      condition     = data.aws_caller_identity.current.account_id == var.expected_account_id
      error_message = "Authenticated AWS account does not match expected_account_id."
    }

    precondition {
      condition     = var.terraform_plan_role_arn != var.terraform_apply_role_arn
      error_message = "Terraform plan and apply roles must be different."
    }

    precondition {
      condition = can(regex(
        "^arn:aws:iam::${var.expected_account_id}:role/CrewSafeGitHubTerraformPlanRole$",
        var.terraform_plan_role_arn,
      ))
      error_message = "Terraform plan role must be the exact normal role in expected_account_id."
    }

    precondition {
      condition = can(regex(
        "^arn:aws:iam::${var.expected_account_id}:role/CrewSafeGitHubTerraformApplyRole$",
        var.terraform_apply_role_arn,
      ))
      error_message = "Terraform apply role must be the exact normal role in expected_account_id."
    }

    precondition {
      condition = alltrue([
        for binding in values(local.policy_bindings) :
        can(jsonencode(binding.rendered_policy))
        && !strcontains(jsonencode(binding.rendered_policy), "<ACCOUNT_ID>")
      ])
      error_message = "Every customer-managed policy must be valid JSON without unresolved account placeholders."
    }

    precondition {
      condition     = length(local.policy_bindings) == 18
      error_message = "The policy-management root must contain exactly eighteen component bindings."
    }
  }
}

resource "aws_iam_policy" "component" {
  for_each = local.policy_bindings

  name        = each.value.policy_name
  path        = each.value.policy_path
  description = "Reviewed CrewSafe Terraform ${each.value.component} ${each.value.role_kind} permissions."
  policy      = jsonencode(each.value.rendered_policy)

  tags = {
    Component = each.value.component
    RoleKind  = each.value.role_kind
    Jira      = "SCRUM-265"
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [terraform_data.input_validation]
}

resource "aws_iam_role_policy_attachment" "component" {
  for_each = local.policy_bindings

  role       = each.value.target_role_name
  policy_arn = aws_iam_policy.component[each.key].arn

  depends_on = [terraform_data.input_validation]
}
