# AWS Cognito user pool

Creates the pool the backend validates tokens against: one user pool, a Hosted UI domain,
the `web` and `mobile` app clients, and the seven demo accounts.

Local development does **not** need this — `infra/local/compose.yaml` runs `cognito-local`
instead. This is for staging, and for testing the real Hosted UI redirect flow, which the
emulator cannot do.

## Use

```bash
aws sts get-caller-identity   # must succeed first - see "Authenticating" below
cp terraform.tfvars.example terraform.tfvars   # then edit it
terraform init
terraform plan
terraform apply
```

## Authenticating

Terraform reads the standard AWS credential chain, so anything that makes
`aws sts get-caller-identity` work will work here. Two ways to get there.

**Never create access keys for the root user.** They cannot be scoped or revoked without
disabling the account. Use root only to create the first IAM identity, then stop.

### IAM user + access keys (fastest)

Console → IAM → Users → Create user → attach `AdministratorAccess` → Security credentials →
Create access key → **Command Line Interface (CLI)**. Then:

```bash
aws configure     # key, secret, region ap-southeast-1, output json
```

The secret then lives in `~/.aws/credentials` until rotated.

### IAM Identity Center (no long-lived secret)

Requires a console step *before* the CLI will work — `aws sso login` fails with
"Missing the following required SSO configuration values" until it is done.

1. Console → **IAM Identity Center** → Enable (pick `ap-southeast-1`; the instance region
   is fixed once chosen)
2. **Users** → Add user
3. **Permission sets** → Create → Predefined → `AdministratorAccess`
4. **AWS accounts** → select the account → Assign users → user + permission set
5. Copy the **AWS access portal URL** from the dashboard (`https://d-xxxx.awsapps.com/start`)

Then locally:

```bash
aws configure sso     # paste the portal URL; SSO region ap-southeast-1; profile e.g. crewsafe
export AWS_PROFILE=crewsafe
aws sso login
```

Re-run `aws sso login` when the session expires. Terraform picks up `AWS_PROFILE`
automatically.

Then point the backend at it:

```bash
terraform output -raw backend_env
```

That prints the five variables the backend reads. Nothing needs to be edited in the repo —
real pool ids are environment values, never committed. Run the backend with them:

```bash
cd ../../backend
SPRING_PROFILES_ACTIVE=staging \
  APP_COGNITO_ISSUER_URI=... APP_COGNITO_JWK_SET_URI=... \
  APP_COGNITO_CLIENT_IDS=... APP_COGNITO_USER_POOL_ID=... APP_COGNITO_REGION=... \
  ./mvnw spring-boot:run
```

Leave `APP_COGNITO_ENDPOINT_OVERRIDE` unset. That variable exists only to point the AWS SDK
at `cognito-local`; unset is what makes it talk to real AWS.

## Things worth knowing before you apply

**The demo password ends up in Terraform state.** `terraform.tfstate` and
`terraform.tfvars` are both gitignored. If this ever moves to a shared S3 backend, turn on
encryption there.

**Usernames are plain, not email-shaped.** `username_attributes` is deliberately not set,
because `DemoDataSeeder` looks accounts up by `worker1`, `supervisor1` and so on. Changing
it later forces the pool to be destroyed and recreated, so it is much cheaper to get right
now.

**Order matters: Cognito first, then the seeder.** `DemoDataSeeder` does not create
accounts — it looks each username up and backfills the Cognito-assigned `sub` into
`app_user`. Run `terraform apply` before starting the backend with the `staging` profile.

**The seeder needs AWS credentials; the request path does not.** With the `staging` profile
the backend calls `AdminGetUser`, so that role needs `cognito-idp:AdminGetUser`. In
production the seeder does not run at all and the backend makes no AWS API calls — it only
fetches JWKS over HTTPS, so it needs no AWS credentials.

**`ALLOW_USER_PASSWORD_AUTH` is deliberately not enabled on these clients.** The local
`cognito-local` fixture does enable it, purely so tests can mint tokens without driving a
browser. On a real public app client it would let anyone POST a username and password
straight at Cognito, bypassing Hosted UI and its protections — a credential-stuffing
endpoint. If you need to mint a token against this pool for testing, add a throwaway third
client with that flow enabled and delete it afterwards, rather than loosening `web` or
`mobile`.

**Callback URLs are an allowlist.** Cognito rejects any redirect URI not listed on the
client, so the deployed web origin has to be added to `web_callback_urls` before the
deployed app can log in.
