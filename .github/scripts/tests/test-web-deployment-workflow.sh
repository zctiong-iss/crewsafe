#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../../.." && pwd)"
workflow="$root/.github/workflows/web-ci.yml"
sync_script="$root/web/scripts/sync-static-site.sh"

# The workflow owns orchestration.
for needle in \
  'needs: build-test' \
  'CREWSAFE_WEB_SYNC_ROLE_ARN' \
  'verify-edge-contract.sh' \
  'sync-static-site.sh' \
  'create-invalidation' \
  'GITHUB_STEP_SUMMARY'
do
  rg -q -F -- "$needle" "$workflow"
done

# The shared script owns the S3/cache implementation.
for needle in \
  'aws s3 sync dist' \
  '--delete' \
  '--exclude "index.html"' \
  '--cache-control "public, max-age=31536000, immutable"' \
  'aws s3 cp dist/index.html' \
  '--cache-control "no-store"'
do
  rg -q -F -- "$needle" "$sync_script"
done

! rg -q \
  'CREWSAFE_WEB_ECR\|docker build\|docker push\|trivy-action\|continue-on-error:' \
  "$workflow"
