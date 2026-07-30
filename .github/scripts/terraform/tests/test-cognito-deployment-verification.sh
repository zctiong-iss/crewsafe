#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
script="$ROOT/.github/scripts/terraform/verify-cognito-deployment.sh"
fixture_dir="$(mktemp -d)"
trap 'rm -rf "$fixture_dir"' EXIT
expected_oidc_subject="repo:zctiong-iss@267492605/crewsafe@1310783821:ref:refs/heads/main"

[[ -x "$script" ]]

mock_bin="$fixture_dir/bin"
tf_root="$fixture_dir/terraform-root"
mkdir -p "$mock_bin" "$tf_root/.backend"
printf '%s\n' \
  'key = "crewsafe/cognito/shared-dev.tfstate"' \
  'region = "ap-southeast-1"' >"$tf_root/.backend/state.s3.tfbackend"

cat >"$mock_bin/terraform" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ "${1:-}" == -chdir=* && "${2:-}" == output && "${3:-}" == -raw ]]
case "${4:-}" in
  user_pool_id) printf 'ap-southeast-1_TEST123\n' ;;
  issuer_uri) printf 'https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_TEST123\n' ;;
  domain_url) printf 'https://crewsafe-shared-dev-123456789012.auth.ap-southeast-1.amazoncognito.com\n' ;;
  web_client_id) printf 'web-client-id\n' ;;
  mobile_client_id) printf 'mobile-client-id\n' ;;
  cli_client_id) printf 'cli-client-id\n' ;;
  administration_role_arn) printf 'arn:aws:iam::123456789012:role/CrewSafeGitHubCognitoAdminRole\n' ;;
  *) echo "unexpected mocked Terraform output: ${4:-}" >&2; exit 1 ;;
esac
EOF

cat >"$mock_bin/aws" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

case "${1:-} ${2:-}" in
  "sts get-caller-identity")
    printf '123456789012\n'
    ;;
  "cognito-idp describe-user-pool")
    printf '%s\n' '{"UserPool":{"Name":"crewsafe-shared-dev","DeletionProtection":"ACTIVE","UserPoolTier":"ESSENTIALS","AdminCreateUserConfig":{"AllowAdminCreateUserOnly":true},"UsernameConfiguration":{"CaseSensitive":false},"UsernameAttributes":["email"],"AutoVerifiedAttributes":["email"],"MfaConfiguration":"OFF","Policies":{"PasswordPolicy":{"TemporaryPasswordValidityDays":30}}}}'
    ;;
  "cognito-idp describe-user-pool-client")
    client_id=""
    while (($#)); do
      if [[ "$1" == --client-id ]]; then
        client_id="${2:?mocked client ID is required}"
        break
      fi
      shift
    done
    case "$client_id" in
      web-client-id)
        name=crewsafe-web
        validity=15
        unit=minutes
        flows='["ALLOW_REFRESH_TOKEN_AUTH"]'
        ;;
      mobile-client-id)
        name=crewsafe-mobile
        validity=1
        unit=hours
        flows='["ALLOW_REFRESH_TOKEN_AUTH"]'
        ;;
      cli-client-id)
        name=crewsafe-cli-integration
        validity=15
        unit=minutes
        flows='["ALLOW_USER_PASSWORD_AUTH","ALLOW_REFRESH_TOKEN_AUTH"]'
        ;;
      *)
        echo "unexpected mocked Cognito client: $client_id" >&2
        exit 1
        ;;
    esac
    secret=""
    if [[ "${MOCK_CLIENT_SECRET:-false}" == true && "$client_id" == web-client-id ]]; then
      secret=',"ClientSecret":"must-not-appear-in-output"'
    fi
    printf '{"UserPoolClient":{"ClientName":"%s"%s,"PreventUserExistenceErrors":"ENABLED","EnableTokenRevocation":true,"AccessTokenValidity":%s,"TokenValidityUnits":{"AccessToken":"%s"},"ExplicitAuthFlows":%s}}\n' \
      "$name" "$secret" "$validity" "$unit" "$flows"
    ;;
  "cognito-idp describe-user-pool-domain")
    printf '%s\n' '{"DomainDescription":{"UserPoolId":"ap-southeast-1_TEST123","Status":"ACTIVE"}}'
    ;;
  "cognito-idp list-groups")
    printf '%s\n' '{"Groups":[{"GroupName":"developers","RoleArn":null,"Precedence":null},{"GroupName":"synthetic-test-users","RoleArn":null,"Precedence":null}]}'
    ;;
  "iam get-role")
    provider_account=123456789012
    audience=sts.amazonaws.com
    subject=repo:zctiong-iss@267492605/crewsafe@1310783821:ref:refs/heads/main
    case "${MOCK_OIDC_MISMATCH:-}" in
      subject) subject=repo:zctiong-iss/crewsafe:ref:refs/heads/main ;;
      audience) audience=example.invalid ;;
      provider) provider_account=999999999999 ;;
      "") ;;
      *) echo "unexpected OIDC mismatch fixture" >&2; exit 1 ;;
    esac
    printf '{"Role":{"AssumeRolePolicyDocument":{"Statement":[{"Effect":"Allow","Principal":{"Federated":"arn:aws:iam::%s:oidc-provider/token.actions.githubusercontent.com"},"Action":"sts:AssumeRoleWithWebIdentity","Condition":{"StringEquals":{"token.actions.githubusercontent.com:aud":"%s","token.actions.githubusercontent.com:sub":"%s"}}}]}}}\n' \
      "$provider_account" "$audience" "$subject"
    ;;
  *)
    echo "unexpected mocked AWS command: $*" >&2
    exit 1
    ;;
esac
EOF

cat >"$mock_bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' '{"keys":[{"kid":"synthetic-key"}]}'
EOF

chmod +x "$mock_bin/terraform" "$mock_bin/aws" "$mock_bin/curl"

PATH="$mock_bin:$PATH" \
  "$script" "$tf_root" 123456789012 ap-southeast-1 \
    crewsafe/cognito/shared-dev.tfstate "$expected_oidc_subject" >/dev/null

negative_output="$fixture_dir/negative-output"
if PATH="$mock_bin:$PATH" MOCK_CLIENT_SECRET=true \
  "$script" "$tf_root" 123456789012 ap-southeast-1 \
    crewsafe/cognito/shared-dev.tfstate "$expected_oidc_subject" \
    >"$negative_output" 2>&1; then
  echo "Verifier accepted a Cognito client secret." >&2
  exit 1
fi
grep -Fq 'crewsafe-web' "$negative_output"
if grep -Fq 'must-not-appear-in-output' "$negative_output"; then
  echo "Verifier exposed a Cognito client secret." >&2
  exit 1
fi

for mismatch in subject audience provider; do
  if PATH="$mock_bin:$PATH" MOCK_OIDC_MISMATCH="$mismatch" \
    "$script" "$tf_root" 123456789012 ap-southeast-1 \
      crewsafe/cognito/shared-dev.tfstate "$expected_oidc_subject" \
      >"$negative_output" 2>&1; then
    echo "Verifier accepted an OIDC $mismatch mismatch." >&2
    exit 1
  fi
  grep -Fq 'administration role trust mismatch' "$negative_output"
done

echo "Cognito deployment verification test passed"
