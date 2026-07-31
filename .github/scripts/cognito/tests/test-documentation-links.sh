#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
for file in \
  docs/runbooks/SCRUM-154-shared-cognito.md \
  docs/runbooks/SCRUM-190-synthetic-cognito-users.md \
  docs/adr/0006-shared-remote-cognito-for-development.md \
  docs/plans/SCRUM-154-shared-cognito-terraform-plan.md \
  docs/plans/SCRUM-190-synthetic-cognito-users-plan.md; do
  [[ -s "$ROOT/$file" ]]
done
grep -Eq 'ADR 0006|0006-shared-remote-cognito' "$ROOT/docs/adr/0004-aws-cognito-for-authentication.md"
grep -Fq 'SCRUM-190-synthetic-cognito-users.md' \
  "$ROOT/docs/runbooks/SCRUM-154-shared-cognito.md"
grep -Fq '0006-shared-remote-cognito-for-development.md' \
  "$ROOT/docs/runbooks/SCRUM-190-synthetic-cognito-users.md"
grep -Fq 'no permanent user or secret deletion' \
  "$ROOT/docs/runbooks/SCRUM-190-synthetic-cognito-users.md"
grep -Fq 'Do not run Terraform, AWS CLI, or an AWS profile locally' \
  "$ROOT/docs/runbooks/SCRUM-190-synthetic-cognito-users.md"
legacy_root='infra/aws/cognito'"-staging"
if grep -ERn "$legacy_root" "$ROOT/web" "$ROOT/run.sh"; then
  exit 1
fi
