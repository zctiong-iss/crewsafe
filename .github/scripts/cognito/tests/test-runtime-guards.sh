#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
! rg -n 'terraform|aws configure|sts get-caller-identity|cognito-local' "$ROOT/run.sh"
! rg -n 'cognito-local' "$ROOT/infra/local/compose.yaml"
! rg -n 'endpoint-override|localhost:9229' "$ROOT/backend/src/main/resources/application-local.yml"
