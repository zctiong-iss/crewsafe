#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
DEPLOY_SCRIPT="$root/.github/scripts/deploy/deploy-backend-staging.sh"

assert_web_deploy_order() {
  local workflow="$1" verify_line sync_line invalidate_line
  verify_line="$(rg -n -F 'verify-edge-contract.sh' "$workflow" | head -1 | cut -d: -f1)"
  sync_line="$(rg -n -F 'sync-static-site.sh' "$workflow" | head -1 | cut -d: -f1)"
  invalidate_line="$(rg -n -F 'create-invalidation' "$workflow" | head -1 | cut -d: -f1)"
  [[ "$verify_line" -lt "$sync_line" && "$sync_line" -lt "$invalidate_line" ]] || {
    printf 'FAIL: %s must verify the edge contract, sync static files, then invalidate CloudFront.\n' "$workflow" >&2
    exit 1
  }
}

for needle in 'deploy-staging:' 'needs: [build-test, publish-image, resolve-existing-image]' 'resolve-existing-image:' 'CREWSAFE_BACKEND_DEPLOY_ROLE_ARN' 'deploy-backend-staging.sh'; do rg -q -F "$needle" "$root/.github/workflows/backend-ci.yml"; done
for needle in 'LIGHTNING_INGESTION_ENABLED' '/lightning/ingestion-enabled' 'register-task-definition'; do rg -q -F "$needle" "$DEPLOY_SCRIPT"; done
rg -q -F '      - ".github/scripts/deploy/deploy-backend-staging.sh"' "$root/.github/workflows/backend-ci.yml"
for needle in 'deploy-staging:' 'needs: build-test' 'npm run audit' 'verify-edge-contract.sh' 'sync-static-site.sh' 'create-invalidation' "'/*'"; do rg -q -F "$needle" "$root/.github/workflows/web-ci.yml"; done
for needle in 'npm run audit' 'verify-edge-contract.sh' 'sync-static-site.sh'; do rg -q -F "$needle" "$root/.github/workflows/web-sync.yml"; done
assert_web_deploy_order "$root/.github/workflows/web-ci.yml"
assert_web_deploy_order "$root/.github/workflows/web-sync.yml"
if rg -q 'CREWSAFE_WEB_ECR\|docker build\|docker push\|trivy-action' "$root/.github/workflows/web-ci.yml"; then
  exit 1
fi
for needle in 'dast-staging:' 'needs: deploy-staging' 'uses: ./.github/workflows/dast-staging.yml' 'trigger_component: backend' 'DAST_SYNTHETIC_WORKER_PASSWORD'; do rg -q -F "$needle" "$root/.github/workflows/backend-ci.yml"; done
for needle in 'dast-staging:' 'needs: deploy-staging' 'uses: ./.github/workflows/dast-staging.yml' 'trigger_component: web' 'DAST_SYNTHETIC_WORKER_PASSWORD'; do rg -q -F "$needle" "$root/.github/workflows/web-ci.yml"; done
