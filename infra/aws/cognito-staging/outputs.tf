output "user_pool_id" {
  description = "Cognito user pool id."
  value       = aws_cognito_user_pool.crewsafe.id
}

output "web_client_id" {
  description = "App client id for the React web app."
  value       = aws_cognito_user_pool_client.web.id
}

output "mobile_client_id" {
  description = "App client id for the React Native app."
  value       = aws_cognito_user_pool_client.mobile.id
}

output "hosted_ui_url" {
  description = "Hosted UI base URL. Clients redirect here to log in."
  value       = "https://${aws_cognito_user_pool_domain.hosted_ui.domain}.auth.${var.region}.amazoncognito.com"
}

# Written out longhand rather than using the pool's `endpoint` attribute, because this is
# exactly the string Cognito puts in every token's `iss` claim and exactly what
# JwtIssuerValidator compares against. Seeing the shape here is worth more than saving a
# few characters.
locals {
  issuer_uri = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.crewsafe.id}"
}

output "issuer_uri" {
  description = "The `iss` claim on every token this pool issues."
  value       = local.issuer_uri
}

# The whole point of this stack: the backend's configuration, ready to paste.
# These are the exact variable names CognitoProperties binds - see backend/src/main/
# resources/application.yml. APP_COGNITO_ENDPOINT_OVERRIDE is deliberately absent; it is
# set only for cognito-local, and leaving it unset is what points the AWS SDK at real AWS.
output "backend_env" {
  description = "Environment variables for the backend."
  value       = <<-EOT
    APP_COGNITO_ISSUER_URI=${local.issuer_uri}
    APP_COGNITO_JWK_SET_URI=${local.issuer_uri}/.well-known/jwks.json
    APP_COGNITO_CLIENT_IDS=${aws_cognito_user_pool_client.web.id},${aws_cognito_user_pool_client.mobile.id}
    APP_COGNITO_USER_POOL_ID=${aws_cognito_user_pool.crewsafe.id}
    APP_COGNITO_REGION=${var.region}
  EOT
}
