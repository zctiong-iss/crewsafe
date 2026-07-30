# Trying this on your own AWS account

A few ways to get a working pool, in order of least to most effort:

1. **Use the Terraform in this directory anyway.** `main.tf` works against any account -
   just `cp terraform.tfvars.example terraform.tfvars`, fill it in, and `terraform apply`
   with your own credentials. See the main [README](README.md) for the full flow.
2. **AWS CLI.** Commands below create the same stack by hand.
3. **AWS Console.** Click through Cognito directly - use `main.tf` as the spec for what
   settings to pick.

Either way, the result is: one user pool, a Hosted UI domain, `web` and `mobile` app
clients, and the seven demo accounts `DemoDataSeeder` expects.

## AWS CLI

```bash
REGION=ap-southeast-1
ENVIRONMENT=dev

USER_POOL_ID=$(aws cognito-idp create-user-pool \
  --region "$REGION" \
  --pool-name "crewsafe-${ENVIRONMENT}" \
  --admin-create-user-config AllowAdminCreateUserOnly=true \
  --policies '{"PasswordPolicy":{"MinimumLength":12,"RequireUppercase":true,"RequireLowercase":true,"RequireNumbers":true,"RequireSymbols":false}}' \
  --mfa-configuration OFF \
  --query 'UserPool.Id' --output text)

# domain prefix must be globally unique across all of AWS
HOSTED_UI_DOMAIN="crewsafe-${ENVIRONMENT}-<pick-a-unique-suffix>"
aws cognito-idp create-user-pool-domain \
  --region "$REGION" --domain "$HOSTED_UI_DOMAIN" --user-pool-id "$USER_POOL_ID"

WEB_CLIENT_ID=$(aws cognito-idp create-user-pool-client \
  --region "$REGION" --user-pool-id "$USER_POOL_ID" --client-name web \
  --no-generate-secret \
  --allowed-o-auth-flows-user-pool-client --allowed-o-auth-flows code \
  --allowed-o-auth-scopes openid email profile \
  --supported-identity-providers COGNITO \
  --callback-urls "http://localhost:5173/callback" \
  --logout-urls "http://localhost:5173/" \
  --explicit-auth-flows ALLOW_REFRESH_TOKEN_AUTH \
  --access-token-validity 15 --id-token-validity 15 --refresh-token-validity 7 \
  --token-validity-units AccessToken=minutes,IdToken=minutes,RefreshToken=days \
  --prevent-user-existence-errors ENABLED \
  --query 'UserPoolClient.ClientId' --output text)

MOBILE_CLIENT_ID=$(aws cognito-idp create-user-pool-client \
  --region "$REGION" --user-pool-id "$USER_POOL_ID" --client-name mobile \
  --no-generate-secret \
  --allowed-o-auth-flows-user-pool-client --allowed-o-auth-flows code \
  --allowed-o-auth-scopes openid email profile \
  --supported-identity-providers COGNITO \
  --callback-urls "crewsafe://callback" \
  --logout-urls "crewsafe://" \
  --explicit-auth-flows ALLOW_REFRESH_TOKEN_AUTH \
  --access-token-validity 1 --id-token-validity 60 --refresh-token-validity 7 \
  --token-validity-units AccessToken=hours,IdToken=minutes,RefreshToken=days \
  --prevent-user-existence-errors ENABLED \
  --query 'UserPoolClient.ClientId' --output text)

# usernames must match what DemoDataSeeder expects - it looks each one up, doesn't create it
for USERNAME in supervisor1 supervisor2 worker1 worker2 worker3 manager1 admin1; do
  aws cognito-idp admin-create-user --region "$REGION" --user-pool-id "$USER_POOL_ID" \
    --username "$USERNAME" --message-action SUPPRESS
  aws cognito-idp admin-set-user-password --region "$REGION" --user-pool-id "$USER_POOL_ID" \
    --username "$USERNAME" --password '<pick a password satisfying the policy above>' --permanent
done
```

## Running it locally

`./run.sh` reads pool settings from `terraform output`, so it only works if you set this
up with Terraform. Otherwise, export these yourself and run the backend directly:

```bash
export APP_COGNITO_ISSUER_URI="https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}"
export APP_COGNITO_JWK_SET_URI="${APP_COGNITO_ISSUER_URI}/.well-known/jwks.json"
export APP_COGNITO_CLIENT_IDS="${WEB_CLIENT_ID},${MOBILE_CLIENT_ID}"
export APP_COGNITO_USER_POOL_ID="$USER_POOL_ID"
export APP_COGNITO_REGION="$REGION"
export SPRING_PROFILES_ACTIVE=staging   # so DemoDataSeeder creates the app_user rows
export CORS_ALLOWED_ORIGINS=http://localhost:5173

cd backend && ./mvnw spring-boot:run
```

And for the web console, copy `web/.env.example` to `web/.env.local` and fill in:

```bash
VITE_COGNITO_AUTHORITY=https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}
VITE_COGNITO_CLIENT_ID=${WEB_CLIENT_ID}
VITE_COGNITO_HOSTED_UI_DOMAIN=https://${HOSTED_UI_DOMAIN}.auth.${REGION}.amazoncognito.com
VITE_REDIRECT_URI=http://localhost:5173/callback
VITE_POST_LOGOUT_REDIRECT_URI=http://localhost:5173/
VITE_API_BASE_URL=http://localhost:8080
```

Then `cd web && npm install && npm run dev`, and sign in with one of the demo usernames.

## Worth knowing

- Usernames are plain, not email-shaped - don't set an email verification attribute on the
  pool, `DemoDataSeeder` looks accounts up by `worker1`, `supervisor1`, and so on.
- Callback URLs are an allowlist - add any other origin you use before it can log in.
- None of this is tracked as Terraform state. Import it later if you want, or just tear it
  down and run Terraform fresh.
