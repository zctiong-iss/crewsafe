#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
TESTS_RUN=0
TESTS_FAILED=0

pass() { printf '  ok   %s\n' "$1"; }
fail() {
  printf '  FAIL %s\n' "$1"
  [[ $# -gt 1 ]] && printf '       %s\n' "$2"
  TESTS_FAILED=$((TESTS_FAILED + 1))
}

contains() {
  local label="$1" file="$2" text="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ -f "$file" ]] && rg -q -F -- "$text" "$file"; then pass "$label"; else fail "$label" "missing: $text"; fi
}

not_contains() {
  local label="$1" file="$2" text="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ ! -f "$file" ]] || ! rg -q -F -- "$text" "$file"; then pass "$label"; else fail "$label" "forbidden: $text"; fi
}

APP="$ROOT/backend/src/main/resources/application.yml"
COMPUTE="$ROOT/infra/terraform/compute/main.tf"
TF_TEST="$ROOT/infra/terraform/compute/tests/compute.tftest.hcl"

contains "Spring Boot ECS console format is configured" "$APP" "console: ecs"
contains "ECS service name is configured" "$APP" 'name: ${spring.application.name}'
contains "ECS environment metadata is configured" "$APP" 'environment: ${SPRING_PROFILES_ACTIVE:local}'
not_contains "legacy pattern logging is removed" "$APP" "pattern:"
contains "ECS awslogs driver remains configured" "$COMPUTE" 'logDriver = "awslogs"'
contains "ECS logging is non-blocking" "$COMPUTE" '"mode"                  = "non-blocking"'
contains "ECS log buffer is explicitly bounded" "$COMPUTE" '"max-buffer-size"       = "25m"'
contains "Terraform contract checks non-blocking mode" "$TF_TEST" 'options["mode"] == "non-blocking"'
contains "Terraform contract checks bounded buffer" "$TF_TEST" 'options["max-buffer-size"] == "25m"'

sources=(
  "$ROOT/backend/src/main/java/com/crewsafe/mitigation/ai/bedrock/BedrockApiClient.java"
  "$ROOT/backend/src/main/java/com/crewsafe/mitigation/ai/bedrock/BedrockMitigationService.java"
  "$ROOT/backend/src/main/java/com/crewsafe/identity/security/CognitoJwtAuthenticationConverter.java"
  "$ROOT/backend/src/main/java/com/crewsafe/common/error/GlobalExceptionHandler.java"
  "$ROOT/backend/src/main/java/com/crewsafe/identity/security/SiteAccessEvaluator.java"
  "$ROOT/backend/src/main/java/com/crewsafe/operation/api/ActionDispatchController.java"
  "$ROOT/backend/src/main/java/com/crewsafe/operation/service/ActionDispatchService.java"
  "$ROOT/backend/src/main/java/com/crewsafe/policy/service/PolicyEngineService.java"
)
unsafe_tokens=("context" "responseBody" "textContent" "jwt.getSubject()" "principal.getId()" "request.getWorkerId()" "dispatchId" "workerId" "siteId" "e.getMessage()")

for source in "${sources[@]}"; do
  while IFS= read -r line; do
    [[ "$line" == *"log."* ]] || continue
    for token in "${unsafe_tokens[@]}"; do
      TESTS_RUN=$((TESTS_RUN + 1))
      if [[ "$line" == *"$token"* ]]; then fail "log source guard $(basename "$source")" "forbidden token: $token"; else pass "log source guard $(basename "$source") excludes $token"; fi
    done
  done < "$source"
done

printf '\n%d run, %d failed\n' "$TESTS_RUN" "$TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]
