locals {
  issuer_uri = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.shared_dev.id}"
}

output "user_pool_id" { value = aws_cognito_user_pool.shared_dev.id }
output "user_pool_arn" { value = aws_cognito_user_pool.shared_dev.arn }
output "region" { value = var.aws_region }
output "issuer_uri" { value = local.issuer_uri }
output "jwks_uri" { value = "${local.issuer_uri}/.well-known/jwks.json" }
output "domain_url" {
  value = "https://${aws_cognito_user_pool_domain.shared_dev.domain}.auth.${var.aws_region}.amazoncognito.com"
}
output "web_client_id" { value = aws_cognito_user_pool_client.web.id }
output "mobile_client_id" { value = aws_cognito_user_pool_client.mobile.id }
output "cli_client_id" { value = aws_cognito_user_pool_client.cli.id }
output "groups" { value = [aws_cognito_user_group.developers.name, aws_cognito_user_group.synthetic_test_users.name] }
output "administration_role_arn" { value = aws_iam_role.cognito_admin.arn }
