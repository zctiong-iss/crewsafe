output "sonar_securityhub_import_role_arn" {
  description = "GitHub Actions role ARN for the CI-only Sonar Security Hub importer."
  value       = aws_iam_role.sonar_securityhub_import.arn
}
