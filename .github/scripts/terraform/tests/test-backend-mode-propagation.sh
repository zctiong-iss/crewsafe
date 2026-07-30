#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
fixture_dir="$(mktemp -d)"
trap 'rm -rf "$fixture_dir"' EXIT

mock_bin="$fixture_dir/bin"
mkdir -p "$mock_bin" "$fixture_dir/bootstrap-work" "$fixture_dir/managed-work"

cat >"$mock_bin/aws" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-} ${2:-}" in
  "s3api head-bucket")
    if [[ "${MOCK_BACKEND_MODE:?}" == bootstrap ]]; then
      echo "An error occurred (404) when calling the HeadBucket operation: Not Found" >&2
      exit 1
    fi
    if [[ " $* " != *" --output off "* ]]; then
      printf '{"BucketArn":"arn:aws:s3:::crewsafe-terraform-state-123456789012-ap-southeast-1"}\n'
    fi
    ;;
  "s3api get-bucket-location")
    printf 'ap-southeast-1\n'
    ;;
  "s3api get-bucket-tagging")
    printf '%s\n' \
      '{"TagSet":[{"Key":"Project","Value":"CrewSafe"},{"Key":"ManagedBy","Value":"Terraform"},{"Key":"DeploymentAccount","Value":"alice"}]}'
    ;;
  "s3api head-object")
    printf '{"ContentLength":123}\n'
    ;;
  *)
    echo "unexpected mocked AWS command: $*" >&2
    exit 1
    ;;
esac
EOF

cat >"$mock_bin/terraform" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >"${TERRAFORM_CALLS:?}"
EOF

chmod +x "$mock_bin/aws" "$mock_bin/terraform"

bootstrap_github_output="$fixture_dir/bootstrap-github-output"
bootstrap_terraform_calls="$fixture_dir/bootstrap-terraform-calls"
(
  cd "$fixture_dir/bootstrap-work"
  GITHUB_OUTPUT="$bootstrap_github_output" \
  GITHUB_WORKSPACE="$ROOT" \
  MOCK_BACKEND_MODE=bootstrap \
  PATH="$mock_bin:$PATH" \
  TERRAFORM_CALLS="$bootstrap_terraform_calls" \
    "$ROOT/.github/scripts/terraform/plan-init.sh" \
      self-bootstrap crewsafe-terraform-state-123456789012-ap-southeast-1 \
      ap-southeast-1 crewsafe/bootstrap/terraform.tfstate alice
)

[[ "$(<"$fixture_dir/bootstrap-work/.backend/mode")" == bootstrap ]]
[[ "$(<"$bootstrap_terraform_calls")" == "init -input=false -lockfile=readonly" ]]
grep -Fxq 'mode=bootstrap' "$bootstrap_github_output"

managed_github_output="$fixture_dir/managed-github-output"
managed_terraform_calls="$fixture_dir/managed-terraform-calls"
(
  cd "$fixture_dir/managed-work"
  GITHUB_OUTPUT="$managed_github_output" \
  GITHUB_WORKSPACE="$ROOT" \
  MOCK_BACKEND_MODE=managed \
  PATH="$mock_bin:$PATH" \
  TERRAFORM_CALLS="$managed_terraform_calls" \
    "$ROOT/.github/scripts/terraform/plan-init.sh" \
      remote crewsafe-terraform-state-123456789012-ap-southeast-1 \
      ap-southeast-1 crewsafe/cognito/shared-dev.tfstate alice
)

[[ "$(<"$fixture_dir/managed-work/.backend/mode")" == managed ]]
[[ "$(<"$managed_terraform_calls")" == \
  "init -input=false -lockfile=readonly -reconfigure -backend-config=.backend/state.s3.tfbackend" ]]
grep -Fxq 'mode=managed' "$managed_github_output"
grep -Fxq 'terraform {' "$fixture_dir/managed-work/.backend/backend.generated.tf"
grep -Fxq '  backend "s3" {}' "$fixture_dir/managed-work/.backend/backend.generated.tf"
grep -Fxq 'bucket = "crewsafe-terraform-state-123456789012-ap-southeast-1"' \
  "$fixture_dir/managed-work/.backend/state.s3.tfbackend"
grep -Fxq 'key = "crewsafe/cognito/shared-dev.tfstate"' \
  "$fixture_dir/managed-work/.backend/state.s3.tfbackend"

echo "Backend mode propagation test passed"
