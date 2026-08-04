# The stable producer contract consumed by SCRUM-145's automated deploy and smoke
# tests, and eventually by the web and mobile clients. Renaming or retyping any of
# these is a breaking change requiring a coordinated update to every consumer —
# see contracts/terraform-outputs.md.
#
# No output carries a credential. Every one is a URL or a name: identifiers, not
# secrets. None is marked `sensitive` for that reason — marking them so would imply
# these values need protecting and would obscure where the real guarantee lives,
# which is that no credential value is in this component's state at all (FR-034).
#
# Four things a consumer might expect are deliberately NOT here: the load balancer's
# DNS name, the distribution's identifier, the task definition ARN, and the running
# image tag. Consumers have no legitimate need for the first three, and the fourth
# is actively misleading — ignore_changes makes Terraform's recorded task definition
# deliberately not the running one (FR-042), so publishing a tag from state would
# invite a consumer to trust a value that is wrong by design.

output "staging_base_url" {
  description = "Public base URL of the deployed backend. Append an API path, or /actuator/health for the probe. This is the distribution's name, not the load balancer's: it survives a load balancer replacement, a task replacement, a redeployment, and every image change, which is exactly what a client storing it needs."
  value       = "https://${aws_cloudfront_distribution.main.domain_name}"
}

output "cluster_name" {
  description = "Cluster the service runs in. Needed by the forced-redeployment procedure, the one operation that deploys a new image, picks up a rotated database credential, and picks up a restored database's address."
  value       = aws_ecs_cluster.main.name
}

output "cluster_arn" {
  description = "ARN of the cluster. CURRENTLY UNCONSUMED, and retained deliberately. It was published for FR-032, which required the execution and task roles to be pinned to this cluster. SCRUM-191 established that AWS does not support pinning an ECS trust policy to a cluster - 'Using the aws:SourceArn condition key to specify a specific cluster is not currently supported, you should use the wildcard to specify all clusters' - so it applied account-and-region source conditions instead and never read this value. Removing this output is a change to a published contract, not an obvious cleanup; see section 10 of this component's runbook and section 12 of the SCRUM-174 runbook before deciding."
  value       = aws_ecs_cluster.main.arn
}

output "service_name" {
  description = "The service. Paired with cluster_name in every deployment and diagnostic command. Together they are the AUTHORITATIVE source for what is running - Terraform state is not, because ignore_changes on task_definition means the recorded revision is deliberately the initial one and not the live one."
  value       = aws_ecs_service.backend.name
}

output "log_group_name" {
  description = "Where container output lands, under a 14-day retention. The only diagnosis path for a task that fails to start: an image-pull failure, a failed migration, a missing required configuration property, and a read-only-filesystem startup failure all surface here and nowhere else. Its name is constrained rather than chosen - outside /crewsafe/shared-dev/* the execution role's log-write grant does not cover it and the task cannot start."
  value       = aws_cloudwatch_log_group.backend.name
}
