variable "expected_account_id" {
  description = "Twelve-digit AWS account the caller must be authenticated against."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.expected_account_id))
    error_message = "expected_account_id must contain exactly 12 digits."
  }
}

variable "account_alias" {
  description = "Registered account alias used for dispatch traceability."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]+(?:-[a-z0-9]+)*$", var.account_alias))
    error_message = "account_alias must use lowercase letters, digits, and single hyphens."
  }
}

variable "aws_region" {
  description = "AWS Region for the shared CrewSafe deployment."
  type        = string
  default     = "ap-southeast-1"

  validation {
    condition     = var.aws_region == "ap-southeast-1"
    error_message = "CrewSafe Terraform is restricted to ap-southeast-1."
  }
}

variable "terraform_plan_role_arn" {
  description = "Existing shared Terraform plan role receiving the plan policies."
  type        = string

  validation {
    condition     = can(regex("^arn:aws:iam::[0-9]{12}:role/CrewSafeGitHubTerraformPlanRole$", var.terraform_plan_role_arn))
    error_message = "terraform_plan_role_arn must be the exact shared Terraform plan role ARN."
  }
}

variable "terraform_apply_role_arn" {
  description = "Existing shared Terraform apply role receiving the apply policies."
  type        = string

  validation {
    condition     = can(regex("^arn:aws:iam::[0-9]{12}:role/CrewSafeGitHubTerraformApplyRole$", var.terraform_apply_role_arn))
    error_message = "terraform_apply_role_arn must be the exact shared Terraform apply role ARN."
  }
}
