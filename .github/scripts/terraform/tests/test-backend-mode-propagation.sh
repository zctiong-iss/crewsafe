#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
fixture_dir="$(mktemp -d)"
trap 'rm -rf "$fixture_dir"' EXIT

mock_bin="$fixture_dir/bin"
mkdir -p "$mock_bin" "$fixture_dir/work"

cat >"$mock_bin/aws" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-} ${2:-}" in
  "s3api head-bucket")
    echo "An error occurred (404) when calling the HeadBucket operation: Not Found" >&2
    exit 1
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

github_output="$fixture_dir/github-output"
terraform_calls="$fixture_dir/terraform-calls"
(
  cd "$fixture_dir/work"
  GITHUB_OUTPUT="$github_output" \
  GITHUB_WORKSPACE="$ROOT" \
  PATH="$mock_bin:$PATH" \
  TERRAFORM_CALLS="$terraform_calls" \
    "$ROOT/.github/scripts/terraform/plan-init.sh" \
      self-bootstrap crewsafe-terraform-state-123456789012-ap-southeast-1 \
      ap-southeast-1 crewsafe/bootstrap/terraform.tfstate alice
)

[[ "$(<"$fixture_dir/work/.backend/mode")" == bootstrap ]]
[[ "$(<"$terraform_calls")" == "init -input=false -lockfile=readonly" ]]
grep -Fxq 'mode=bootstrap' "$github_output"

echo "Backend mode propagation test passed"
