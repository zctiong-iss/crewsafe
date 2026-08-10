#!/usr/bin/env bash
set -euo pipefail

for required in REPOSITORY IMAGE_TAG IMAGE_DIGEST CLUSTER SERVICE; do
  [[ -n "${!required:-}" ]] || { echo "Missing $required" >&2; exit 1; }
done
[[ "$REPOSITORY" =~ ^[0-9]{12}\.dkr\.ecr\.ap-southeast-1\.amazonaws\.com/crewsafe/backend$ ]] || { echo "Unexpected repository" >&2; exit 1; }
[[ "$IMAGE_TAG" =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid image tag" >&2; exit 1; }
[[ "$IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "Invalid image digest" >&2; exit 1; }
[[ "$CLUSTER" == "crewsafe-shared-dev" && "$SERVICE" == "backend" ]] || { echo "Unexpected ECS target" >&2; exit 1; }

actual_digest="$(aws ecr describe-images --repository-name crewsafe/backend --image-ids imageTag="$IMAGE_TAG" --query 'imageDetails[0].imageDigest' --output text)"
[[ "$actual_digest" == "$IMAGE_DIGEST" ]] || { echo "Published tag does not resolve to the expected digest" >&2; exit 1; }

tmp_dir="$(mktemp -d)"; trap 'rm -rf "$tmp_dir"' EXIT
aws ecs describe-task-definition --task-definition crewsafe-shared-dev-backend --query taskDefinition --output json >"$tmp_dir/current.json"
jq --arg image "$REPOSITORY@$IMAGE_DIGEST" '
  del(.taskDefinitionArn,.revision,.status,.requiresAttributes,.compatibilities,.registeredAt,.registeredBy,.deregisteredAt)
  | .containerDefinitions |= map(if .name == "backend" then .image=$image else . end)
  | if ([.containerDefinitions[] | select(.name == "backend")] | length) == 1 then . else error("missing backend container") end
' "$tmp_dir/current.json" >"$tmp_dir/next.json"
task_definition="$(aws ecs register-task-definition --cli-input-json "file://$tmp_dir/next.json" --query 'taskDefinition.taskDefinitionArn' --output text)"
[[ "$task_definition" == *"task-definition/crewsafe-shared-dev-backend:"* ]] || { echo "Unexpected task definition" >&2; exit 1; }
aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --task-definition "$task_definition" --force-new-deployment >/dev/null

for _ in $(seq 1 60); do
  state="$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --query "services[0].deployments[?taskDefinition==\`$task_definition\`].rolloutState | [0]" --output text)"
  reason="$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --query "services[0].deployments[?taskDefinition==\`$task_definition\`].rolloutStateReason | [0]" --output text)"
  [[ "$state" == "COMPLETED" ]] && break
  [[ "$state" == "FAILED" || "$state" == "None" ]] && { echo "Deployment failed: $reason" >&2; exit 1; }
  sleep 10
done
[[ "${state:-}" == "COMPLETED" ]] || { echo "Deployment timed out" >&2; exit 1; }
{ echo "task_definition=$task_definition"; echo "rollout_state=$state"; } >>"${GITHUB_OUTPUT:-/dev/null}"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then printf '## Backend staging deployment\n- Commit SHA: `%s`\n- Image digest: `%s`\n- Task definition: `%s`\n- Result: promoted\n' "$IMAGE_TAG" "$IMAGE_DIGEST" "$task_definition" >>"$GITHUB_STEP_SUMMARY"; fi
