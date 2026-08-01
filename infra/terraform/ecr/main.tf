data "aws_caller_identity" "current" {}

locals {
  # Must live under crewsafe/* - the secrets component's task-execution role already
  # grants ecr:BatchCheckLayerAvailability/BatchGetImage/GetDownloadUrlForLayer scoped
  # to arn:aws:ecr:<region>:<account>:repository/crewsafe/*. Naming this repository
  # outside that prefix would silently leave it outside that existing pull grant.
  repository_name = "crewsafe/backend"

  push_role_name = "crewsafe-shared-dev-ecr-push"

  # FR: image-push is scoped to this repository and nothing else, so a compromised
  # workflow run cannot touch any other repository in the account.
  repository_arn = "arn:aws:ecr:${var.aws_region}:${var.expected_account_id}:repository/${local.repository_name}"

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

  # Composed as an HCL object and rendered with jsonencode() rather than built with
  # data "aws_iam_policy_document" - under mock_provider a data source's `json`
  # attribute is fabricated, so an assertion about its content would check invented
  # data. A jsonencode() of configuration is pure Terraform computation, identical
  # under a mock and against the real provider (same reasoning the secrets
  # component documents for its own policies).
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
        # The one grant in this component reaching outside its own repository scope.
        # ecr:GetAuthorizationToken does not support resource-level permissions - the
        # ECR API accepts nothing but "*" for it, which is why AWS's own
        # AmazonEC2ContainerRegistryPowerUser policy is written the same way. Held to
        # exactly one action in exactly one statement so it cannot quietly acquire a
        # second (asserted by the iam_boundary test).
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
# One repository. MUTABLE tag mutability is a deliberate trade-off: every push
# writes both an immutable-in-practice commit-SHA tag and a genuinely mutable
# `latest` tag to the same image, so the repository as a whole cannot be set to
# IMMUTABLE without the `latest` tag failing on every push after the first.
# ---------------------------------------------------------------------------

resource "aws_ecr_repository" "backend" {
  name                 = local.repository_name
  image_tag_mutability = "MUTABLE"

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

# Bounds storage cost: every push to main produces a new image. Untagged images
# (left behind by a failed or partial push) expire quickly; the newest 20 tagged
# images are kept regardless of tag, which is comfortably more than SCRUM-176's
# compute runtime would ever need to roll back across.
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

# ---------------------------------------------------------------------------
# Push identity
#
# Assumable by a GitHub Actions run on this repository's main branch, and by
# nothing else - no wildcard principal, no other ref, no other repository. This
# is deliberately independent of CREWSAFE_AWS_ACCOUNTS_JSON's plan_role_arn /
# apply_role_arn: those two roles manage Terraform state and must not also carry
# image-push permissions for an unrelated purpose. Mirrors the proven pattern in
# infra/terraform/cognito/main.tf's aws_iam_role.cognito_admin.
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
