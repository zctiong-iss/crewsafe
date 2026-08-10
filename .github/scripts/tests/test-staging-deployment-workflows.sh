#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
for needle in 'deploy-staging:' 'needs: publish-image' 'CREWSAFE_BACKEND_DEPLOY_ROLE_ARN' 'deploy-backend-staging.sh'; do rg -q -F "$needle" "$root/.github/workflows/backend-ci.yml"; done
for needle in 'deploy-staging:' 'needs: build-test' 'aws s3 sync' 'create-invalidation' "'/*'"; do rg -q -F "$needle" "$root/.github/workflows/web-ci.yml"; done
! rg -q 'CREWSAFE_WEB_ECR\|docker build\|docker push\|trivy-action' "$root/.github/workflows/web-ci.yml"
