#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
if rg -n 'terraform|aws configure|sts get-caller-identity|cognito-local' "$ROOT/run.sh"; then
  exit 1
fi
if rg -n 'cognito-local' "$ROOT/infra/local/compose.yaml"; then
  exit 1
fi
if rg -n 'endpoint-override|localhost:9229' "$ROOT/backend/src/main/resources/application-local.yml"; then
  exit 1
fi
