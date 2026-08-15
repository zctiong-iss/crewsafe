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

output "web_repository_url" {
  description = "Registry URL for the future web image publication and runtime consumers, e.g. <account>.dkr.ecr.<region>.amazonaws.com/crewsafe/web."
  value       = aws_ecr_repository.web.repository_url
}

output "web_repository_arn" {
  description = "Exact ARN of the crewsafe/web repository for future runtime pull policy scoping."
  value       = aws_ecr_repository.web.arn
}

output "web_push_role_arn" {
  description = "ARN of the dedicated future web GitHub Actions image-push role."
  value       = aws_iam_role.web_ecr_push.arn
}

output "ml_service_repository_url" {
  description = "Registry URL for the ml-service image publication and the compute component's runtime pull, e.g. <account>.dkr.ecr.<region>.amazonaws.com/crewsafe/ml-service."
  value       = aws_ecr_repository.ml_service.repository_url
}

output "ml_service_repository_arn" {
  description = "Exact ARN of the crewsafe/ml-service repository for runtime pull policy scoping."
  value       = aws_ecr_repository.ml_service.arn
}

output "ml_service_push_role_arn" {
  description = "ARN of the dedicated ml-service GitHub Actions image-push role. Set as CREWSAFE_ML_SERVICE_ECR_PUSH_ROLE_ARN, used by .github/workflows/ml-service-ci.yml."
  value       = aws_iam_role.ml_service_ecr_push.arn
}

output "securityhub_ecr_insight_arn" {
  description = "ARN of the stable Security Hub Insight for active Critical and High Inspector ECR findings."
  value       = aws_securityhub_insight.ecr_active_critical_high.arn
}
