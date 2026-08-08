data "aws_caller_identity" "current" {}

locals {
  role_name   = "crewsafe-shared-dev-sonar-securityhub-import"
  product_arn = "arn:aws:securityhub:${var.aws_region}:${var.expected_account_id}:product/${var.expected_account_id}/default"
  hub_arn     = "arn:aws:securityhub:${var.aws_region}:${var.expected_account_id}:hub/default"
}

resource "terraform_data" "input_validation" {
  input = {
    account_id = var.expected_account_id
    region     = var.aws_region
    subject    = var.github_oidc_main_subject
  }

  lifecycle {
    precondition {
      condition     = data.aws_caller_identity.current.account_id == var.expected_account_id
      error_message = "Authenticated AWS account does not match expected_account_id."
    }
  }
}

resource "aws_iam_role" "sonar_securityhub_import" {
  name        = local.role_name
  description = "GitHub main-only role that imports narrowly redacted Sonar vulnerabilities into Security Hub."
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = "arn:aws:iam::${var.expected_account_id}:oidc-provider/token.actions.githubusercontent.com" }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = { StringEquals = {
        "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        "token.actions.githubusercontent.com:sub" = var.github_oidc_main_subject
      } }
    }]
  })

  lifecycle {
    precondition {
      condition     = data.aws_caller_identity.current.account_id == var.expected_account_id
      error_message = "Importer role is restricted to the approved AWS account."
    }
  }
  depends_on = [terraform_data.input_validation]
}

resource "aws_iam_role_policy" "sonar_securityhub_import" {
  name = "${local.role_name}-securityhub"
  role = aws_iam_role.sonar_securityhub_import.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "ImportOnlyCustomProduct", Effect = "Allow", Action = ["securityhub:BatchImportFindings"], Resource = local.product_arn, Condition = { StringEquals = { "securityhub:TargetAccount" = var.expected_account_id } } },
      { Sid = "ReadOnlyIdentityReconciliation", Effect = "Allow", Action = ["securityhub:GetFindings"], Resource = local.hub_arn }
    ]
  })
}
