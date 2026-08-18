#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/web-ci.yml"
DOCKERFILE="$ROOT/web/Dockerfile"
DOCKERIGNORE="$ROOT/web/.dockerignore"
NGINX_CONF="$ROOT/web/nginx.conf"
TESTS_RUN=0
TESTS_FAILED=0
TMP_DIRS=()
readonly OIDC_PERMISSION='id-token: write'

cleanup() {
  local dir
  for dir in "${TMP_DIRS[@]}"; do
    [[ -e "$dir" ]] && rm -rf "$dir"
  done
}
trap cleanup EXIT INT TERM

pass() {
  local label="$1"
  printf '  ok   %s\n' "$label"
}

fail() {
  local label="$1" detail="${2:-}"
  printf '  FAIL %s\n' "$label"
  [[ $# -gt 1 ]] && printf '       %s\n' "$detail"
  TESTS_FAILED=$((TESTS_FAILED + 1))
}

contains_in() {
  local label="$1" path="$2" needle="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ -f "$path" ]] && rg -q -F -- "$needle" "$path"; then
    pass "$label"
  else
    fail "$label" "missing text in $path: $needle"
  fi
}

not_contains_in() {
  local label="$1" path="$2" needle="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ ! -f "$path" ]] || ! rg -q -F -- "$needle" "$path"; then
    pass "$label"
  else
    fail "$label" "forbidden text found in $path: $needle"
  fi
}

check_file() {
  local label="$1" path="$2"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ -f "$path" ]]; then
    pass "$label"
  else
    fail "$label" "missing file: $path"
  fi
}

assert_order() {
  local label="$1" path="$2"
  shift 2
  local previous=0 current needle
  for needle in "$@"; do
    current="$(rg -n -m 1 -F -- "$needle" "$path" | cut -d: -f1 || true)"
    if [[ -z "$current" || "$current" -le "$previous" ]]; then
      TESTS_RUN=$((TESTS_RUN + 1))
      fail "$label" "expected ordered text: $needle"
      return
    fi
    previous="$current"
  done
  TESTS_RUN=$((TESTS_RUN + 1))
  pass "$label"
}

not_contains_in_build_test() {
  local label="$1" needle="$2" block
  block="$(awk '
    /^  build-test:/ { started = 1 }
    started && /^  publish-image:/ { exit }
    started { print }
  ' "$WORKFLOW")"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ "$block" != *"$needle"* ]]; then
    pass "$label"
  else
    fail "$label" "forbidden validation-job text found: $needle"
  fi
}

workflow_policy_guard() {
  local path="$1"
  [[ -f "$path" ]] || return 1
  rg -q -F -- 'needs: build-test' "$path" || return 1
  rg -q -F -- "github.ref == 'refs/heads/main'" "$path" || return 1
  rg -q -F -- 'github.event_name == '\''push'\''' "$path" || return 1
  rg -q -F -- 'inputs.publish' "$path" || return 1
  rg -q -F -- 'default: false' "$path" || return 1
  rg -q -F -- 'contents: read' "$path" || return 1
  rg -q -F -- "$OIDC_PERMISSION" "$path" || return 1
  rg -q -F -- 'CREWSAFE_WEB_ECR_REPOSITORY_URL' "$path" || return 1
  rg -q -F -- 'CREWSAFE_WEB_ECR_PUSH_ROLE_ARN' "$path" || return 1
  rg -q -F -- '^[0-9]{12}\.dkr\.ecr\.${AWS_REGION}\.amazonaws\.com/crewsafe/web$' "$path" || return 1
  rg -q -F -- '[[ "$IMAGE_TAG" =~ ^[0-9a-f]{40}$ ]]' "$path" || return 1
  rg -q -F -- 'GITHUB_STEP_SUMMARY' "$path" || return 1
  rg -q -F -- 'RepoDigests' "$path" || return 1

  if rg -n 'uses: .+@' "$path" | rg -v '@[0-9a-f]{40}$' >/dev/null; then
    return 1
  fi
  if rg -n -e 'crewsafe/backend' -e 'IMAGE_TAG: latest' -e ':latest' -e 'AWS_ACCESS_KEY_ID' \
    -e 'AWS_SECRET_ACCESS_KEY' -e 'AWS_SESSION_TOKEN' -e 'continue-on-error:' \
    -e 'contents: write' -e 'id-token: read' "$path" >/dev/null; then
    return 1
  fi
  return 0
}

replace_fixture_text() {
  local path="$1" pattern="$2" replacement="$3"
  sed "s|$pattern|$replacement|g" "$path" > "$path.next"
  mv "$path.next" "$path"
}

mutate_fixture() {
  local path="$1" mutation="$2"
  case "$mutation" in
    backend-repository)
      replace_fixture_text "$path" 'crewsafe/web' 'crewsafe/backend'
      ;;
    unrelated-repository)
      replace_fixture_text "$path" '/crewsafe/web' '/crewsafe/unrelated'
      ;;
    latest-tag)
      printf '\nIMAGE_TAG: latest\n' >> "$path"
      ;;
    malformed-tag)
      replace_fixture_text "$path" '{40}' '{39}'
      ;;
    missing-oidc)
      replace_fixture_text "$path" "$OIDC_PERMISSION" 'id-token: read'
      ;;
    non-main-manual)
      replace_fixture_text "$path" 'refs/heads/main' 'refs/heads/feature'
      ;;
    publish-default-true)
      replace_fixture_text "$path" 'default: false' 'default: true'
      ;;
    missing-digest-summary)
      sed '/GITHUB_STEP_SUMMARY/d' "$path" > "$path.next"
      mv "$path.next" "$path"
      ;;
    continue-on-error)
      printf '\ncontinue-on-error: true\n' >> "$path"
      ;;
    mutable-action)
      printf '\n      - uses: actions/checkout@main\n' >> "$path"
      ;;
    widened-permission)
      printf '\ncontents: write\n' >> "$path"
      ;;
    secret-output)
      printf "\nrun: echo \"\$AWS_SECRET_ACCESS_KEY\"\n" >> "$path"
      ;;
    *)
      printf 'unknown fixture mutation: %s\n' "$mutation" >&2
      return 1
      ;;
  esac
}

assert_rejected_fixture() {
  local label="$1" mutation="$2"
  local fixture
  fixture="$(mktemp)"
  TMP_DIRS+=("$fixture")
  cp "$WORKFLOW" "$fixture"
  mutate_fixture "$fixture" "$mutation"
  TESTS_RUN=$((TESTS_RUN + 1))
  if ! workflow_policy_guard "$fixture"; then
    pass "$label"
  else
    fail "$label" "workflow policy guard accepted mutation: $mutation"
  fi
}

check_file "web workflow exists" "$WORKFLOW"
check_file "web Dockerfile exists" "$DOCKERFILE"
check_file "web Docker ignore exists" "$DOCKERIGNORE"
check_file "web nginx configuration exists" "$NGINX_CONF"
TESTS_RUN=$((TESTS_RUN + 1))
if workflow_policy_guard "$WORKFLOW"; then
  pass "base workflow passes policy guard"
else
  fail "base workflow passes policy guard"
fi

contains_in "workflow dispatch is available" "$WORKFLOW" 'workflow_dispatch:'
contains_in "manual publication input exists" "$WORKFLOW" 'publish:'
contains_in "manual publication input is boolean" "$WORKFLOW" 'type: boolean'
contains_in "manual publication defaults false" "$WORKFLOW" 'default: false'
contains_in "validation job exists" "$WORKFLOW" 'build-test:'
contains_in "publication job exists" "$WORKFLOW" 'publish-image:'
contains_in "publication waits for validation" "$WORKFLOW" 'needs: build-test'
contains_in "publication is main-only" "$WORKFLOW" "github.ref == 'refs/heads/main'"
contains_in "push publication predicate exists" "$WORKFLOW" "github.event_name == 'push'"
contains_in "manual publication predicate exists" "$WORKFLOW" "github.event_name == 'workflow_dispatch'"
contains_in "manual publication requires true" "$WORKFLOW" 'inputs.publish'
contains_in "web ECR URL variable is scoped" "$WORKFLOW" 'CREWSAFE_WEB_ECR_REPOSITORY_URL'
contains_in "web ECR role variable is scoped" "$WORKFLOW" 'CREWSAFE_WEB_ECR_PUSH_ROLE_ARN'
contains_in "publication has read permission" "$WORKFLOW" 'contents: read'
contains_in "publication has OIDC permission" "$WORKFLOW" "$OIDC_PERMISSION"
contains_in "AWS credentials action is pinned" "$WORKFLOW" 'aws-actions/configure-aws-credentials@e6de'
contains_in "publication uses web ECR login" "$WORKFLOW" 'aws ecr get-login-password'
contains_in "publication builds web image" "$WORKFLOW" 'docker build'
contains_in "publication scans image" "$WORKFLOW" 'aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25'
contains_in "publication scan blocks high findings" "$WORKFLOW" 'exit-code: 1'
contains_in "publication pushes image" "$WORKFLOW" 'docker push'
contains_in "publication records digest" "$WORKFLOW" 'RepoDigests'
contains_in "publication writes job outputs" "$WORKFLOW" 'GITHUB_OUTPUT'
contains_in "publication writes summary" "$WORKFLOW" 'GITHUB_STEP_SUMMARY'
contains_in "publication uses source SHA tag" "$WORKFLOW" 'github.sha'
not_contains_in "workflow has no static AWS access key" "$WORKFLOW" 'AWS_ACCESS_KEY_ID'
not_contains_in "workflow has no static AWS secret key" "$WORKFLOW" 'AWS_SECRET_ACCESS_KEY'
not_contains_in "workflow does not publish latest" "$WORKFLOW" ':latest'
not_contains_in "workflow has no deployment path" "$WORKFLOW" 'aws ecs'
not_contains_in "workflow has no continue-on-error" "$WORKFLOW" 'continue-on-error:'
not_contains_in_build_test "validation job has no OIDC permission" "$OIDC_PERMISSION"
not_contains_in_build_test "validation job has no AWS credential action" 'configure-aws-credentials'
not_contains_in_build_test "validation job has no image push" 'docker push'

assert_order "web validation remains before publication" "$WORKFLOW" \
  'npm ci' 'npm run lint' 'npm run typecheck' 'npm test' 'npm run build' 'publish-image:'
assert_order "image build and scan precede push" "$WORKFLOW" \
  'docker build' 'aquasecurity/trivy-action' 'docker push' 'RepoDigests'

# --- SCRUM-269 (mirrored to web): reviewed, expiring exceptions ----------
contains_in "ignorefile prep step references the source exceptions file" "$WORKFLOW" \
  'web-image.trivyignore.source'
contains_in "ignorefile prep step invokes filter-trivyignore.sh" "$WORKFLOW" \
  'filter-trivyignore.sh'
contains_in "scan step passes the active ignorefile via trivyignores" "$WORKFLOW" \
  'trivyignores: .trivyignore-active-web'
assert_order "ignorefile prep precedes the scan step" "$WORKFLOW" \
  'filter-trivyignore.sh' 'aquasecurity/trivy-action'

contains_in "Docker build stage is digest-only pinned" "$DOCKERFILE" 'FROM node@sha256:'
contains_in "Docker build stage tag is preserved as a comment" "$DOCKERFILE" 'node:22-bookworm'
contains_in "Docker build stage is digest pinned" "$DOCKERFILE" '@sha256:'
contains_in "Docker uses lockfile installation" "$DOCKERFILE" 'npm ci'
contains_in "Docker build stage ignores npm lifecycle scripts" "$DOCKERFILE" 'npm ci --ignore-scripts'
contains_in "Docker runtime stage is digest-only pinned" "$DOCKERFILE" 'FROM nginxinc/nginx-unprivileged@sha256:'
contains_in "Docker runtime stage tag is preserved as a comment" "$DOCKERFILE" 'nginx-unprivileged:1.31.3-alpine3.24'
contains_in "Docker runtime uses unprivileged nginx" "$DOCKERFILE" 'nginxinc/nginx-unprivileged'
contains_in "Docker copies production assets" "$DOCKERFILE" 'COPY --from=build /app/dist'
contains_in "Docker declares non-privileged port" "$DOCKERFILE" 'EXPOSE 8080'
contains_in "Docker declares non-root runtime" "$DOCKERFILE" 'USER nginx'
not_contains_in "nginx.conf copy grants no runtime-user ownership" "$DOCKERFILE" '--chown=nginx:nginx'
contains_in "nginx serves SPA fallback" "$NGINX_CONF" "try_files \$uri /index.html"
contains_in "nginx listens on non-privileged port" "$NGINX_CONF" 'listen 8080'
contains_in "Docker ignores git metadata" "$DOCKERIGNORE" '.git'
contains_in "Docker ignores dependencies" "$DOCKERIGNORE" 'node_modules'
contains_in "Docker ignores build output" "$DOCKERIGNORE" 'dist'
contains_in "Docker ignores environment files" "$DOCKERIGNORE" '.env*'
not_contains_in "Dockerfile has no environment build argument" "$DOCKERFILE" 'ARG VITE_'

assert_rejected_fixture "negative backend repository fixture is rejected" backend-repository
assert_rejected_fixture "negative unrelated repository fixture is rejected" unrelated-repository
assert_rejected_fixture "negative mutable tag fixture is rejected" latest-tag
assert_rejected_fixture "negative malformed tag fixture is rejected" malformed-tag
assert_rejected_fixture "negative missing OIDC boundary fixture is rejected" missing-oidc
assert_rejected_fixture "negative non-main publication fixture is rejected" non-main-manual
assert_rejected_fixture "negative publish=false fixture is rejected" publish-default-true
assert_rejected_fixture "negative missing digest summary fixture is rejected" missing-digest-summary
assert_rejected_fixture "negative continue-on-error fixture is rejected" continue-on-error
assert_rejected_fixture "negative mutable action fixture is rejected" mutable-action
assert_rejected_fixture "negative widened permission fixture is rejected" widened-permission
assert_rejected_fixture "negative secret output fixture is rejected" secret-output

printf '\n%d run, %d failed\n' "$TESTS_RUN" "$TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]
