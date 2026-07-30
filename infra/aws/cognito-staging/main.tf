terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

# The user pool. Accounts are administered, never self-service (FR-01), so sign-up is
# closed and only an admin can create a user.
resource "aws_cognito_user_pool" "crewsafe" {
  name = "crewsafe-${var.environment}"

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  password_policy {
    minimum_length    = 12
    require_uppercase = true
    require_lowercase = true
    require_numbers   = true
    require_symbols   = false
  }

  # Out of scope for this project - recorded in ADR 0004 rather than left as a silent gap.
  mfa_configuration = "OFF"

  # Note what is deliberately NOT set: username_attributes = ["email"]. That would make
  # every username email-shaped, and DemoDataSeeder looks users up by plain usernames
  # ("worker1", "supervisor1"). Setting it forces a pool replacement, so it is easier to
  # get right now than to change later.

  tags = {
    Project     = "crewsafe"
    Environment = var.environment
  }
}

# Hosted UI needs a domain - it is the login surface, so without this there is nowhere for
# clients to redirect to. The prefix must be globally unique across all of AWS.
resource "aws_cognito_user_pool_domain" "hosted_ui" {
  domain       = var.hosted_ui_domain
  user_pool_id = aws_cognito_user_pool.crewsafe.id
}

# The web app client.
#
# Public client: no secret, because a browser cannot keep one. PKCE is what protects the
# authorization code instead, and the client library handles it.
resource "aws_cognito_user_pool_client" "web" {
  name         = "web"
  user_pool_id = aws_cognito_user_pool.crewsafe.id

  generate_secret = false

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]

  callback_urls = var.web_callback_urls
  logout_urls   = var.web_logout_urls

  # Hosted UI only. ALLOW_USER_PASSWORD_AUTH is deliberately absent: it would let anyone
  # POST a username and password straight at Cognito, bypassing the Hosted UI entirely and
  # handing an attacker a credential-stuffing endpoint. The local cognito-local fixture
  # does enable it, but only so tests can mint tokens without a browser - see README.
  explicit_auth_flows = ["ALLOW_REFRESH_TOKEN_AUTH"]

  access_token_validity  = 15
  id_token_validity      = 15
  refresh_token_validity = 7

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  # Do not tell an unauthenticated caller whether a username exists.
  prevent_user_existence_errors = "ENABLED"
}

# The mobile app client.
#
# Same shape as web, with a longer access token. A worker on patchy site data should not
# spend an eight-hour shift refreshing every 15 minutes - each refresh is a chance to fail.
# Account status is re-read from the database on every request, so the longer token does
# not delay a deactivation taking effect.
resource "aws_cognito_user_pool_client" "mobile" {
  name         = "mobile"
  user_pool_id = aws_cognito_user_pool.crewsafe.id

  generate_secret = false

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]

  callback_urls = var.mobile_callback_urls
  logout_urls   = var.mobile_logout_urls

  explicit_auth_flows = ["ALLOW_REFRESH_TOKEN_AUTH"]

  access_token_validity  = 1
  id_token_validity      = 60
  refresh_token_validity = 7

  token_validity_units {
    access_token  = "hours"
    id_token      = "minutes"
    refresh_token = "days"
  }

  prevent_user_existence_errors = "ENABLED"
}

# The seven demo accounts.
#
# These must exist in Cognito *before* DemoDataSeeder runs: the seeder does not create
# accounts, it looks each username up and backfills the Cognito-assigned `sub` into
# app_user. A missing user fails the seeder loudly rather than silently skipping a row.
#
# The password lands in Terraform state, so state is a secret here. .gitignore already
# excludes *.tfstate; if this ever moves to a shared S3 backend, enable encryption on it.
resource "aws_cognito_user" "demo" {
  for_each = toset(var.demo_usernames)

  user_pool_id = aws_cognito_user_pool.crewsafe.id
  username     = each.value

  password       = var.demo_user_password
  message_action = "SUPPRESS"
}
