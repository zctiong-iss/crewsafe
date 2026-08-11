#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"; workflow="$root/.github/workflows/web-ci.yml"
for needle in 'needs: build-test' 'CREWSAFE_WEB_SYNC_ROLE_ARN' 'aws s3 sync' '--delete' 'create-invalidation' 'GITHUB_STEP_SUMMARY'; do rg -q -F -- "$needle" "$workflow"; done
! rg -q 'CREWSAFE_WEB_ECR\|docker build\|docker push\|trivy-action\|continue-on-error:' "$workflow"
