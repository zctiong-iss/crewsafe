#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
workflow="$ROOT/.github/workflows/cognito-mapping-publication.yml"

[[ -s "$workflow" ]]
grep -Fq 'workflow_dispatch:' "$workflow"
! grep -Eq '^  (push|pull_request|schedule):' "$workflow"
grep -Fq "github.ref == 'refs/heads/main'" "$workflow"
grep -Fq 'cognito-mapping-publication-${{ inputs.target_account_alias }}' "$workflow"
grep -Fq 'cancel-in-progress: false' "$workflow"
grep -Fq 'resolve-mapping-publication.sh' "$workflow"
grep -Fq 'id-token: write' "$workflow"
grep -Fq 'aws-actions/configure-aws-credentials@e6de054238d6b7531b4efff3b6587d9aade6a06c' "$workflow"
grep -Fq 'crewsafe-shared-dev-cognito-mapping-publish' "$workflow"
grep -Fq 'EXPECTED_MAPPING_CHECKSUM' "$workflow"
grep -Fq 'aws ssm put-parameter --name "$PARAMETER_NAME" --type String --overwrite --value "$(<"$mapping_file")"' "$workflow"
grep -Fq '.github/scripts/deploy/deploy-backend-staging.sh' "$workflow"
grep -Fq 'role-session-name: CrewSafeCognitoMappingPublication-${{ github.run_id }}' "$workflow"
! grep -Eiq 'aws_access_key_id|aws_secret_access_key|CREWSAFE_.*(SECRET|TOKEN|MAPPING_JSON)' "$workflow"
! grep -Fq 'mapping_json' "$workflow"
echo "Cognito mapping publication workflow: PASS"
