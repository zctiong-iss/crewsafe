# The stable producer contract consumed by the database and backend compute
# components through terraform_remote_state. Renaming or retyping any of these is
# a breaking change requiring a coordinated update to every consumer — see
# contracts/terraform-outputs.md.
#
# No output carries a secret value. Every one is an ARN, a role name, or a path:
# identifiers, not credentials. None is marked `sensitive` for that reason —
# marking them so would imply these values need protecting and would obscure where
# the real guarantee lives, which is that no value is in state at all (FR-005).
#
# Two things a consumer needs are deliberately NOT here, because this component
# does not own them:
#   - the database master credential's ARN — the managed database service creates
#     and names it (FR-029); the database component publishes it
#   - the database connection URL — its value does not exist until the database
#     does, so the database component declares that entry under
#     config_parameter_prefix (FR-031)

output "weather_api_key_secret_arn" {
  description = "ARN of the weather API key secret container. Reference this from a task definition's `secrets` block, never its `environment` block. Do not append a version id or stage: a pinned reference makes rotation require a task-definition change (FR-016)."
  value       = aws_secretsmanager_secret.weather_api_key.arn
}

output "config_parameter_prefix" {
  description = "Hierarchical path every configuration parameter lives under, with no trailing slash. Consumers append '/name'. The database component creates its URL entry here (FR-031); anything created outside this prefix is not covered by the read grant."
  value       = local.parameter_path_prefix
}

output "task_execution_role_arn" {
  description = "For a task definition's executionRoleArn. The container platform assumes this to pull the image, open the log stream, and resolve secret references at task start."
  value       = aws_iam_role.task_execution.arn
}

output "task_role_arn" {
  description = "For a task definition's taskRoleArn. The running application assumes this; it reads the two credentials it needs and holds nothing else."
  value       = aws_iam_role.task.arn
}

output "task_execution_role_name" {
  description = "The execution role's bare name. Exists so the database component can attach an additional policy pinning the service-managed credential by its exact ARN once that secret exists, narrowing FR-029's prefix grant after the fact. Not unused — deleting it removes the only path to tightening that grant."
  value       = aws_iam_role.task_execution.name
}
