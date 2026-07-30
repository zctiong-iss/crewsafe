#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
for file in \
  docs/runbooks/SCRUM-154-shared-cognito.md \
  docs/adr/0006-shared-remote-cognito-for-development.md \
  docs/plans/SCRUM-154-shared-cognito-terraform-plan.md; do
  [[ -s "$ROOT/$file" ]]
done
rg -q 'ADR 0006|0006-shared-remote-cognito' "$ROOT/docs/adr/0004-aws-cognito-for-authentication.md"
legacy_root='infra/aws/cognito'"-staging"
if rg -n "$legacy_root" "$ROOT/web" "$ROOT/run.sh"; then
  exit 1
fi
