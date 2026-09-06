mock_provider "aws" {}

run "shared_dev_contract" {
  command = plan
  variables {
    expected_account_id      = "123456789012"
    account_alias            = "alice"
    github_oidc_main_subject = "repo:owner@267492605/crewsafe@1310783821:ref:refs/heads/main"
  }
  override_data {
    target = data.aws_caller_identity.current
    values = { account_id = "123456789012" }
  }
  override_resource {
    target = aws_cognito_user_pool.shared_dev
    values = {
      id  = "ap-southeast-1_TestPool"
      arn = "arn:aws:cognito-idp:ap-southeast-1:123456789012:userpool/ap-southeast-1_TestPool"
    }
  }
  assert {
    condition     = aws_cognito_user_pool.shared_dev.name == "crewsafe-shared-dev"
    error_message = "Pool name must be stable."
  }
  assert {
    condition = (
      aws_cognito_user_pool.shared_dev.user_pool_tier == "ESSENTIALS"
      && aws_cognito_user_pool.shared_dev.deletion_protection == "ACTIVE"
      && aws_cognito_user_pool.shared_dev.mfa_configuration == "OFF"
      && aws_cognito_user_pool.shared_dev.admin_create_user_config[0].allow_admin_create_user_only
      && aws_cognito_user_pool.shared_dev.username_configuration[0].case_sensitive == false
      && aws_cognito_user_pool.shared_dev.username_attributes == toset(["email"])
      && aws_cognito_user_pool.shared_dev.auto_verified_attributes == toset(["email"])
    )
    error_message = "The shared pool policy boundary changed."
  }
  assert {
    condition = (
      aws_cognito_user_pool.shared_dev.password_policy[0].minimum_length == 12
      && aws_cognito_user_pool.shared_dev.password_policy[0].require_lowercase
      && aws_cognito_user_pool.shared_dev.password_policy[0].require_numbers
      && aws_cognito_user_pool.shared_dev.password_policy[0].require_symbols
      && aws_cognito_user_pool.shared_dev.password_policy[0].require_uppercase
      && aws_cognito_user_pool.shared_dev.password_policy[0].temporary_password_validity_days == 30
    )
    error_message = "The password or 30-day invitation policy changed."
  }
  assert {
    condition     = aws_cognito_user_pool_client.web.generate_secret == false && !contains(aws_cognito_user_pool_client.web.explicit_auth_flows, "ALLOW_USER_PASSWORD_AUTH")
    error_message = "Web must be a bounded public client."
  }
  assert {
    condition = (
      length(aws_cognito_user_pool_client.web.callback_urls) == 2
      && toset(aws_cognito_user_pool_client.web.callback_urls) == toset([
        "http://localhost:5173/callback",
        "https://d3b75ru76gta2n.cloudfront.net/callback",
      ])
    )
    error_message = "Web callback URLs must contain exactly the reviewed local and staging endpoints."
  }
  assert {
    condition = (
      length(aws_cognito_user_pool_client.web.logout_urls) == 2
      && toset(aws_cognito_user_pool_client.web.logout_urls) == toset([
        "http://localhost:5173/",
        "https://d3b75ru76gta2n.cloudfront.net/",
      ])
    )
    error_message = "Web logout URLs must contain exactly the reviewed local and staging endpoints."
  }
  assert {
    condition     = aws_cognito_user_pool_client.mobile.generate_secret == false && !contains(aws_cognito_user_pool_client.mobile.explicit_auth_flows, "ALLOW_USER_PASSWORD_AUTH")
    error_message = "Mobile must be a bounded public client."
  }
  assert {
    condition = (
      aws_cognito_user_pool_client.web.allowed_oauth_flows == toset(["code"])
      && aws_cognito_user_pool_client.mobile.allowed_oauth_flows == toset(["code"])
      && aws_cognito_user_pool_client.cli.generate_secret == false
      && contains(aws_cognito_user_pool_client.cli.explicit_auth_flows, "ALLOW_USER_PASSWORD_AUTH")
      && aws_cognito_user_pool_client.web.enable_token_revocation
      && aws_cognito_user_pool_client.mobile.enable_token_revocation
      && aws_cognito_user_pool_client.cli.enable_token_revocation
      && aws_cognito_user_pool_client.web.access_token_validity == 15
      && aws_cognito_user_pool_client.web.token_validity_units[0].access_token == "minutes"
      && aws_cognito_user_pool_client.mobile.access_token_validity == 1
      && aws_cognito_user_pool_client.mobile.token_validity_units[0].access_token == "hours"
      && aws_cognito_user_pool_client.cli.access_token_validity == 15
      && aws_cognito_user_pool_client.cli.token_validity_units[0].access_token == "minutes"
    )
    error_message = "Client OAuth and direct-auth boundaries changed."
  }
  assert {
    condition = (
      aws_cognito_user_group.developers.name == "developers"
      && aws_cognito_user_group.synthetic_test_users.name == "synthetic-test-users"
      && aws_cognito_user_group.developers.role_arn == null
      && aws_cognito_user_group.synthetic_test_users.role_arn == null
      && aws_cognito_user_group.developers.precedence == null
      && aws_cognito_user_group.synthetic_test_users.precedence == null
    )
    error_message = "Groups must not become application roles or precedence controls."
  }
  assert {
    condition = (
      contains(flatten([for statement in local.cognito_admin_policy.Statement : statement.Action]), "cognito-idp:AdminCreateUser")
      && contains(flatten([for statement in local.cognito_admin_policy.Statement : statement.Action]), "cognito-idp:AdminGetUser")
      && contains(flatten([for statement in local.cognito_admin_policy.Statement : statement.Action]), "cognito-idp:AdminListGroupsForUser")
      && contains(flatten([for statement in local.cognito_admin_policy.Statement : statement.Action]), "cognito-idp:AdminSetUserPassword")
      && contains(flatten([for statement in local.cognito_admin_policy.Statement : statement.Action]), "secretsmanager:GetRandomPassword")
      && contains(flatten([for statement in local.cognito_admin_policy.Statement : statement.Action]), "secretsmanager:CreateSecret")
      && contains(flatten([for statement in local.cognito_admin_policy.Statement : statement.Action]), "secretsmanager:DescribeSecret")
      && contains(flatten([for statement in local.cognito_admin_policy.Statement : statement.Action]), "secretsmanager:PutSecretValue")
      && contains(flatten([for statement in local.cognito_admin_policy.Statement : statement.Action]), "secretsmanager:TagResource")
      && !contains(flatten([for statement in local.cognito_admin_policy.Statement : statement.Action]), "cognito-idp:AdminDeleteUser")
      && !contains(flatten([for statement in local.cognito_admin_policy.Statement : statement.Action]), "secretsmanager:GetSecretValue")
      && !contains(flatten([for statement in local.cognito_admin_policy.Statement : statement.Action]), "secretsmanager:DeleteSecret")
    )
    error_message = "Synthetic-user administration permissions are incomplete or overbroad."
  }
}

run "reject_legacy_name_only_oidc_subject" {
  command = plan
  variables {
    expected_account_id      = "123456789012"
    account_alias            = "alice"
    github_oidc_main_subject = "repo:owner/crewsafe:ref:refs/heads/main"
  }
  override_data {
    target = data.aws_caller_identity.current
    values = { account_id = "123456789012" }
  }
  expect_failures = [var.github_oidc_main_subject]
}

run "reject_wildcard_web_callback_url" {
  command = plan
  variables {
    expected_account_id      = "123456789012"
    account_alias            = "alice"
    github_oidc_main_subject = "repo:owner@267492605/crewsafe@1310783821:ref:refs/heads/main"
    web_callback_urls        = ["http://localhost:5173/callback", "https://*.cloudfront.net/callback"]
  }
  override_data {
    target = data.aws_caller_identity.current
    values = { account_id = "123456789012" }
  }
  expect_failures = [var.web_callback_urls]
}

run "reject_alternate_port_web_callback_url" {
  command = plan
  variables {
    expected_account_id      = "123456789012"
    account_alias            = "alice"
    github_oidc_main_subject = "repo:owner@267492605/crewsafe@1310783821:ref:refs/heads/main"
    web_callback_urls        = ["http://localhost:5174/callback"]
  }
  override_data {
    target = data.aws_caller_identity.current
    values = { account_id = "123456789012" }
  }
  expect_failures = [var.web_callback_urls]
}

run "reject_wildcard_web_logout_url" {
  command = plan
  variables {
    expected_account_id      = "123456789012"
    account_alias            = "alice"
    github_oidc_main_subject = "repo:owner@267492605/crewsafe@1310783821:ref:refs/heads/main"
    web_logout_urls          = ["http://localhost:5173/", "https://*.cloudfront.net/"]
  }
  override_data {
    target = data.aws_caller_identity.current
    values = { account_id = "123456789012" }
  }
  expect_failures = [var.web_logout_urls]
}

run "reject_mobile_web_logout_url" {
  command = plan
  variables {
    expected_account_id      = "123456789012"
    account_alias            = "alice"
    github_oidc_main_subject = "repo:owner@267492605/crewsafe@1310783821:ref:refs/heads/main"
    web_logout_urls          = ["crewsafe://"]
  }
  override_data {
    target = data.aws_caller_identity.current
    values = { account_id = "123456789012" }
  }
  expect_failures = [var.web_logout_urls]
}
