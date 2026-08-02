# Author: Jemilin Beulah
#
# No credentials here - just ARNs and the registry URL.

output "repository_url" {
  description = "Registry URL for docker push/pull, e.g. <account>.dkr.ecr.<region>.amazonaws.com/crewsafe/backend. Set as CREWSAFE_ECR_REPOSITORY_URL."
  value       = aws_ecr_repository.backend.repository_url
}

output "repository_arn" {
  description = "ARN of the crewsafe/backend repository, for consumers (e.g. SCRUM-176's compute component) that want to scope their own pull grant precisely."
  value       = aws_ecr_repository.backend.arn
}

output "push_role_arn" {
  description = "ARN of the GitHub Actions image-push role. Set as CREWSAFE_ECR_PUSH_ROLE_ARN, used by .github/workflows/backend-ci.yml."
  value       = aws_iam_role.ecr_push.arn
}
