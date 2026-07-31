#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
runner="$ROOT/run.sh"
docker_runner="$ROOT/run-docker.sh"
engine_resolver="$ROOT/infra/local/resolve-container-engine.sh"

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

if grep -En 'terraform|aws configure|sts get-caller-identity|cognito-local' \
  "$runner" "$docker_runner" "$engine_resolver"; then
  exit 1
fi
if grep -En 'cognito-local' "$ROOT/infra/local/compose.yaml"; then
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
