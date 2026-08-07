# Author: Jemilin Beulah

data "aws_caller_identity" "current" {}

locals {
  # Must stay under crewsafe/* - that's the prefix the secrets component's task
  # role already has pull access to.
  repository_name     = "crewsafe/backend"
  web_repository_name = "crewsafe/web"

  push_role_name     = "crewsafe-shared-dev-ecr-push"
  web_push_role_name = "crewsafe-shared-dev-ecr-web-push"

  repository_arn     = "arn:aws:ecr:${var.aws_region}:${var.expected_account_id}:repository/${local.repository_name}"
  web_repository_arn = "arn:aws:ecr:${var.aws_region}:${var.expected_account_id}:repository/${local.web_repository_name}"
  inspector_product_arn = "arn:aws:securityhub:${var.aws_region}::product/aws/inspector"

  ecr_push_assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowGitHubActionsMainBranchToAssume"
        Effect = "Allow"
        Principal = {
          Federated = "arn:aws:iam::${var.expected_account_id}:oidc-provider/token.actions.githubusercontent.com"
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
            "token.actions.githubusercontent.com:sub" = var.github_oidc_main_subject
          }
        }
      },
    ]
  })

  # jsonencode() instead of aws_iam_policy_document - under mock_provider the
  # data source's json attribute gets faked, so tests would end up asserting on
  # data that was never really rendered.
  ecr_push_policy = {
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "PushContainerImage"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:BatchGetImage",
        ]
        Resource = local.repository_arn
      },
      {
        # GetAuthorizationToken doesn't support resource-level perms, only "*".
        # Kept in its own statement so it can't quietly pick up more actions.
        Sid      = "GetRegistryAuthorizationToken"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
    ]
  }

  web_ecr_push_assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowGitHubActionsMainBranchToAssume"
        Effect = "Allow"
        Principal = {
          Federated = "arn:aws:iam::${var.expected_account_id}:oidc-provider/token.actions.githubusercontent.com"
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
            "token.actions.githubusercontent.com:sub" = var.github_oidc_main_subject
          }
        }
      },
    ]
  })

  web_ecr_push_policy = {
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "PushWebContainerImage"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:BatchGetImage",
        ]
        Resource = local.web_repository_arn
      },
      {
        # GetAuthorizationToken doesn't support resource-level perms, only "*".
        # Kept in its own statement so it can't quietly pick up more actions.
        Sid      = "GetRegistryAuthorizationToken"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
    ]
  }
}

# ---------------------------------------------------------------------------
# Registry
#
# IMMUTABLE tags: once a commit-SHA tag is pushed it can't be overwritten.
# Required by the Trivy config scan (AWS-0031), and CI only ever tags by
# commit SHA anyway, so there's no floating `latest` to break.
# ---------------------------------------------------------------------------

resource "aws_ecr_repository" "backend" {
  name                 = local.repository_name
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  lifecycle {
    precondition {
      condition     = data.aws_caller_identity.current.account_id == var.expected_account_id
      error_message = "Authenticated AWS account does not match the expected account for this dispatch."
    }
  }
}

resource "aws_ecr_repository" "web" {
  name                 = local.web_repository_name
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  lifecycle {
    precondition {
      condition     = data.aws_caller_identity.current.account_id == var.expected_account_id
      error_message = "Authenticated AWS account does not match the expected account for this dispatch."
    }
  }
}

# Untagged images (left over from a failed push) expire after a day; keep the
# newest 20 tagged images, more than enough to roll back across.
resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 1 day"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep the newest 20 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 20
        }
        action = { type = "expire" }
      },
    ]
  })
}

resource "aws_ecr_lifecycle_policy" "web" {
  repository = aws_ecr_repository.web.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 1 day"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep the newest 20 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 20
        }
        action = { type = "expire" }
      },
    ]
  })
}

# ---------------------------------------------------------------------------
# Push identity
#
# Assumable only by GitHub Actions running on this repo's main branch - no
# wildcard principal, no other ref. Kept separate from
# CREWSAFE_AWS_ACCOUNTS_JSON's plan/apply roles, which manage Terraform state
# and shouldn't also carry image-push permissions.
# ---------------------------------------------------------------------------

resource "aws_iam_role" "ecr_push" {
  name        = local.push_role_name
  description = "Assumed by GitHub Actions on this repository's main branch to push the backend container image. Holds push permissions on the crewsafe/backend repository and nothing else."

  assume_role_policy = local.ecr_push_assume_role_policy
}

resource "aws_iam_role_policy" "ecr_push" {
  name   = "${local.push_role_name}-push"
  role   = aws_iam_role.ecr_push.id
  policy = jsonencode(local.ecr_push_policy)
}

resource "aws_iam_role" "web_ecr_push" {
  name        = local.web_push_role_name
  description = "Assumed by the future web GitHub Actions workflow on this repository's main branch to push only the web container image."

  assume_role_policy = local.web_ecr_push_assume_role_policy
}

resource "aws_iam_role_policy" "web_ecr_push" {
  name   = "${local.web_push_role_name}-push"
  role   = aws_iam_role.web_ecr_push.id
  policy = jsonencode(local.web_ecr_push_policy)
}

# ---------------------------------------------------------------------------
# Security Hub / Inspector ECR findings
#
# This is deliberately an account-local control plane. Inspector publishes its
# findings to Security Hub; Terraform does not import ASFF, store finding
# payloads, create external tickets, or perform remediation.
# ---------------------------------------------------------------------------

resource "aws_securityhub_account" "mvp" {
  enable_default_standards = false

  lifecycle {
    precondition {
      condition     = data.aws_caller_identity.current.account_id == var.expected_account_id
      error_message = "Security Hub enablement is restricted to the approved AWS account."
    }
  }
}

resource "aws_inspector2_enabler" "ecr" {
  account_ids   = [var.expected_account_id]
  resource_types = ["ECR"]

  depends_on = [aws_securityhub_account.mvp]

  lifecycle {
    precondition {
      condition     = data.aws_caller_identity.current.account_id == var.expected_account_id
      error_message = "Inspector enablement is restricted to the approved AWS account."
    }
  }
}

resource "aws_ecr_registry_scanning_configuration" "enhanced" {
  scan_type = "ENHANCED"

  rule {
    scan_frequency = "CONTINUOUS_SCAN"

    repository_filter {
      filter      = "crewsafe/backend"
      filter_type = "WILDCARD"
    }

    repository_filter {
      filter      = "crewsafe/web"
      filter_type = "WILDCARD"
    }
  }

  depends_on = [aws_inspector2_enabler.ecr]

  lifecycle {
    precondition {
      condition     = data.aws_caller_identity.current.account_id == var.expected_account_id
      error_message = "Enhanced ECR scanning is restricted to the approved AWS account."
    }
  }
}

resource "aws_securityhub_insight" "ecr_active_critical_high" {
  name               = "CrewSafe ECR Active Critical and High"
  group_by_attribute = "ResourceId"

  filters {
    product_arn {
      comparison = "EQUALS"
      value      = local.inspector_product_arn
    }

    resource_type {
      comparison = "EQUALS"
      value      = "AwsEcrContainerImage"
    }

    record_state {
      comparison = "EQUALS"
      value      = "ACTIVE"
    }

    workflow_status {
      comparison = "EQUALS"
      value      = "NEW"
    }

    workflow_status {
      comparison = "EQUALS"
      value      = "NOTIFIED"
    }

    severity_label {
      comparison = "EQUALS"
      value      = "CRITICAL"
    }

    severity_label {
      comparison = "EQUALS"
      value      = "HIGH"
    }
  }

  depends_on = [
    aws_securityhub_account.mvp,
    aws_inspector2_enabler.ecr,
    aws_ecr_registry_scanning_configuration.enhanced,
  ]

  lifecycle {
    precondition {
      condition     = data.aws_caller_identity.current.account_id == var.expected_account_id
      error_message = "The Security Hub Insight is restricted to the approved AWS account."
    }
  }
}
