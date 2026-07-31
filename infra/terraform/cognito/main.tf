data "aws_caller_identity" "current" {}

locals {
  cognito_admin_policy = {
    Version = "2012-10-17"
    Statement = [{
      Sid    = "AdministerExistingCrewSafeUsers"
      Effect = "Allow"
      Action = [
        "cognito-idp:ListUsers",
        "cognito-idp:ListGroups",
        "cognito-idp:AdminCreateUser",
        "cognito-idp:AdminGetUser",
        "cognito-idp:AdminListGroupsForUser",
        "cognito-idp:AdminSetUserPassword",
        "cognito-idp:AdminEnableUser",
        "cognito-idp:AdminDisableUser",
        "cognito-idp:AdminResetUserPassword",
        "cognito-idp:AdminUserGlobalSignOut",
        "cognito-idp:AdminAddUserToGroup",
        "cognito-idp:AdminRemoveUserFromGroup"
      ]
      Resource = aws_cognito_user_pool.shared_dev.arn
      },
      {
        Sid      = "GenerateSyntheticPasswords"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetRandomPassword"]
        Resource = "*"
      },
      {
        Sid    = "ManageSyntheticCredentialVersions"
        Effect = "Allow"
        Action = [
          "secretsmanager:CreateSecret",
          "secretsmanager:DescribeSecret",
          "secretsmanager:PutSecretValue",
          "secretsmanager:TagResource"
        ]
        Resource = "arn:aws:secretsmanager:${var.aws_region}:${var.expected_account_id}:secret:crewsafe/${var.account_alias}/cognito/synthetic/*"
      }
    ]
  }
}

resource "terraform_data" "account_guard" {
  lifecycle {
    precondition {
      condition     = data.aws_caller_identity.current.account_id == var.expected_account_id
      error_message = "Authenticated AWS account does not match the selected registry account."
    }
  }
}

resource "aws_cognito_user_pool" "shared_dev" {
  name                     = "crewsafe-shared-dev"
  user_pool_tier           = "ESSENTIALS"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  deletion_protection      = "ACTIVE"
  mfa_configuration        = "OFF"

  username_configuration {
    case_sensitive = false
  }

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 30
  }
}

resource "aws_cognito_user_pool_domain" "shared_dev" {
  domain       = "crewsafe-shared-dev-${var.expected_account_id}"
  user_pool_id = aws_cognito_user_pool.shared_dev.id
}

resource "aws_cognito_user_pool_client" "web" {
  name                                 = "crewsafe-web"
  user_pool_id                         = aws_cognito_user_pool.shared_dev.id
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = var.web_callback_urls
  logout_urls                          = var.web_logout_urls
  explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  access_token_validity                = 15
  id_token_validity                    = 15
  refresh_token_validity               = 7

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_pool_client" "mobile" {
  name                                 = "crewsafe-mobile"
  user_pool_id                         = aws_cognito_user_pool.shared_dev.id
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = var.mobile_callback_urls
  logout_urls                          = var.mobile_logout_urls
  explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  access_token_validity                = 1
  id_token_validity                    = 60
  refresh_token_validity               = 7

  token_validity_units {
    access_token  = "hours"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_pool_client" "cli" {
  name                          = "crewsafe-cli-integration"
  user_pool_id                  = aws_cognito_user_pool.shared_dev.id
  generate_secret               = false
  explicit_auth_flows           = ["ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true
  access_token_validity         = 15
  id_token_validity             = 15
  refresh_token_validity        = 1

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_group" "developers" {
  name         = "developers"
  user_pool_id = aws_cognito_user_pool.shared_dev.id
  description  = "Individual human CrewSafe developers; not an application authorization role."
}

resource "aws_cognito_user_group" "synthetic_test_users" {
  name         = "synthetic-test-users"
  user_pool_id = aws_cognito_user_pool.shared_dev.id
  description  = "Non-human integration identities; not an application authorization role."
}

resource "aws_iam_role" "cognito_admin" {
  name = "CrewSafeGitHubCognitoAdminRole"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
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
    }]
  })
}

resource "aws_iam_role_policy" "cognito_admin" {
  name   = "CrewSafeCognitoUserAdministration"
  role   = aws_iam_role.cognito_admin.id
  policy = jsonencode(local.cognito_admin_policy)
}
