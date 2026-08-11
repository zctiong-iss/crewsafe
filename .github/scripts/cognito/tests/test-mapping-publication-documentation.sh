#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
runbook="$ROOT/docs/runbooks/SCRUM-303-cognito-mapping-publication.md"

[[ -s "$runbook" ]]
for state in validation empty success stale denied offline error; do
  grep -Eiq "(^|[^a-z])${state}([^a-z]|$)" "$runbook"
done
grep -Fq 'workflow_dispatch' "$runbook"
grep -Fq 'refs/heads/main' "$runbook"
grep -Fq 'sanitized evidence' "$runbook"
grep -Fq '30 minutes' "$runbook"
grep -Fq 'Do not run Terraform, AWS CLI, or an AWS profile locally' "$runbook"
grep -Fq 'Do not manually edit the database or parameter' "$runbook"
if grep -Eiq 'aws ssm put-parameter|terraform apply|psql ' "$runbook"; then
  echo "runbook contains a forbidden direct-operation example" >&2
  exit 1
fi
echo "Mapping publication documentation: PASS"
