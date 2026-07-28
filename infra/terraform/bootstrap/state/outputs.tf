output "aws_account_id" {
  description = "Verified AWS account ID that owns the backend."
  value       = data.aws_caller_identity.current.account_id
}

output "state_bucket_name" {
  description = "Account-isolated Terraform state bucket."
  value       = aws_s3_bucket.terraform_state.id
}

output "state_bucket_arn" {
  description = "ARN of the account-isolated Terraform state bucket."
  value       = aws_s3_bucket.terraform_state.arn
}

output "backend_region" {
  description = "AWS Region used by the backend."
  value       = var.aws_region
}

output "bootstrap_state_key" {
  description = "Canonical remote-state key for this bootstrap root."
  value       = "crewsafe/bootstrap/terraform.tfstate"
}
