#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
runner="$ROOT/run.sh"
docker_runner="$ROOT/run-docker.sh"
engine_resolver="$ROOT/local/resolve-container-engine.sh"

[[ -x "$runner" && -x "$docker_runner" && -x "$engine_resolver" ]]
[[ "$("$engine_resolver")" == podman ]]
[[ "$(CREWSAFE_CONTAINER_ENGINE=docker "$engine_resolver")" == docker ]]
if CREWSAFE_CONTAINER_ENGINE=unsupported "$engine_resolver" >/dev/null 2>&1; then
  echo "Unsupported container engine was accepted." >&2
  exit 1
fi
if CREWSAFE_CONTAINER_ENGINE=unsupported "$runner" --help >/dev/null 2>&1; then
  echo "Shared runner accepted an unsupported container engine." >&2
  exit 1
fi
CREWSAFE_CONTAINER_ENGINE=unsupported "$docker_runner" --help >/dev/null

grep -Fq 'CREWSAFE_CONTAINER_ENGINE=docker' "$docker_runner"
grep -Fq 'exec ./run.sh "$@"' "$docker_runner"
if grep -En 'gh variable get|spring-boot:run|npm run dev|compose .* up' "$docker_runner"; then
  echo "Docker runner duplicates shared startup logic." >&2
  exit 1
fi

# A comment that NAMES one of these tools is not an invocation of it, so comments are
# stripped before scanning. Same reasoning and the same sed idiom as
# .github/scripts/terraform/tests/test-compute-source-guard.sh: prose explaining where a
# thing lives must not trip the guard enforcing that it is not done here. Without this, a
# cross-reference to a file under infra/terraform/ fails the build, which is what happened
# once run.sh gained one.
#
# `#` opens a comment only at line start or after whitespace, so parameter expansions such
# as ${ACCOUNT#prefix} survive the strip. Line numbers are attached before concatenation so
# a failure still reports the exact file and line.
scan_runners() {
  local f rel
  for f in "$runner" "$docker_runner" "$engine_resolver"; do
    rel="${f#"$ROOT"/}"
    sed -E 's/(^|[[:space:]])#.*$//' "$f" | grep -n '' | sed "s|^|$rel:|"
  done
}

if scan_runners | grep -E 'terraform|aws configure|sts get-caller-identity|cognito-local'; then
  echo "A local runner invokes Terraform, configures AWS, or uses cognito-local." >&2
  echo "Those belong in CI, not on a workstation (AGENTS.md §3)." >&2
  exit 1
fi
if grep -En 'cognito-local' "$ROOT/local/compose.yaml"; then
  exit 1
fi
if grep -En 'endpoint-override|localhost:9229' "$ROOT/backend/src/main/resources/application-local.yml"; then
  exit 1
fi

grep -Fq '.github/cognito/**' "$ROOT/.github/workflows/terraform-validate.yml"
grep -Fq '.github/scripts/cognito/**' "$ROOT/.github/workflows/terraform-validate.yml"
grep -Fq '.github/workflows/cognito-user-administration.yml' \
  "$ROOT/.github/workflows/terraform-validate.yml"
grep -Fq '.github/scripts/cognito/tests/test-*.sh' \
  "$ROOT/.github/workflows/terraform-validate.yml"
