# The stable producer contract this component publishes. No output carries a
# credential - every one is an ARN or a registry URL, matching the same
# no-secrets-in-state rationale the secrets component documents.

output "repository_url" {
  description = "Registry/repository URL for `docker push`/`docker pull`, e.g. <account>.dkr.ecr.<region>.amazonaws.com/crewsafe/backend. Set this as the CREWSAFE_ECR_REPOSITORY_URL repository variable."
  value       = aws_ecr_repository.backend.repository_url
}

output "repository_arn" {
  description = "ARN of the crewsafe/backend repository, for any consumer (e.g. SCRUM-176's compute component) that needs to scope its own pull grant precisely rather than relying on the secrets component's existing crewsafe/* pattern."
  value       = aws_ecr_repository.backend.arn
}

output "push_role_arn" {
  description = "ARN of the GitHub Actions image-push role. Set this as the CREWSAFE_ECR_PUSH_ROLE_ARN repository variable, referenced directly by .github/workflows/backend-ci.yml."
  value       = aws_iam_role.ecr_push.arn
}
