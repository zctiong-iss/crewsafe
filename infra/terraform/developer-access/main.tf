data "aws_caller_identity" "current" {}

locals {
  group_name = "crewsafe-developers"
  user_path  = "/crewsafe/developers/"

  log_group_arn_pattern = "arn:aws:logs:${var.aws_region}:${var.expected_account_id}:log-group:/crewsafe/shared-dev/*:*"
  secret_arn_pattern    = "arn:aws:secretsmanager:${var.aws_region}:${var.expected_account_id}:secret:*"

  # The shared read-only policy every developer inherits through group membership.
  # Built with jsonencode() over this local, never data "aws_iam_policy_document" — a
  # mocked provider fabricates that data source's json attribute, which would make every
  # downstream policy assertion in developer-access.tftest.hcl meaningless (research.md
  # R-009, reused from secrets-and-iam's R-004 finding).
  #
  # Per-statement scoping follows research.md R-002. ListLogGroups is isolated into its
  # own Resource: "*" statement rather than folded into a scoped one — this exact action's
  # lack of resource-level support is the documented lesson in
  # docs/runbooks/SCRUM-175-postgres-staging.md §5.
  read_only_policy = {
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadEcsResources"
        Effect   = "Allow"
        Action   = ["ecs:List*", "ecs:Describe*"]
        Resource = "*"
      },
      {
        Sid      = "ReadRdsInstanceMetadata"
        Effect   = "Allow"
        Action   = ["rds:DescribeDBInstances"]
        Resource = "*"
      },
      {
        Sid      = "ReadNetworkResources"
        Effect   = "Allow"
        Action   = ["ec2:Describe*"]
        Resource = "*"
      },
      {
        Sid      = "ListLogGroups"
        Effect   = "Allow"
        Action   = ["logs:DescribeLogGroups"]
        Resource = "*"
      },
      {
        Sid      = "ReadLogContent"
        Effect   = "Allow"
        Action   = ["logs:GetLogEvents", "logs:FilterLogEvents"]
        Resource = local.log_group_arn_pattern
      },
      {
        Sid      = "ListSecretsMetadata"
        Effect   = "Allow"
        Action   = ["secretsmanager:ListSecrets"]
        Resource = "*"
      },
      {
        Sid      = "DescribeSecretsMetadata"
        Effect   = "Allow"
        Action   = ["secretsmanager:DescribeSecret"]
        Resource = local.secret_arn_pattern
      },
    ]
  }
}

resource "aws_iam_group" "developers" {
  name = local.group_name
}

resource "aws_iam_group_policy" "developers_read_only" {
  name   = "crewsafe-developers-read-only"
  group  = aws_iam_group.developers.name
  policy = jsonencode(local.read_only_policy)
}

resource "aws_iam_user" "developer" {
  for_each = { for d in var.developers : d.username => d }

  name = each.value.username
  path = local.user_path
}

resource "aws_iam_user_login_profile" "developer" {
  for_each = aws_iam_user.developer

  user                    = each.value.name
  password_reset_required = true
  password_length         = 20
}

resource "aws_iam_access_key" "developer" {
  for_each = aws_iam_user.developer

  user = each.value.name
}

resource "aws_iam_user_group_membership" "developer" {
  for_each = aws_iam_user.developer

  user   = each.value.name
  groups = [aws_iam_group.developers.name]
}

resource "terraform_data" "input_validation" {
  input = {
    expected_account_id = var.expected_account_id
    account_alias       = var.account_alias
  }

  lifecycle {
    precondition {
      condition     = data.aws_caller_identity.current.account_id == var.expected_account_id
      error_message = "Authenticated AWS account does not match expected_account_id."
    }
  }
}
