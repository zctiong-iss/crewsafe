variable "expected_account_id" {
  description = "Twelve-digit AWS account ID selected through the GitHub account registry."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.expected_account_id))
    error_message = "expected_account_id must contain exactly 12 digits."
  }
}

variable "account_alias" {
  description = "Stable lowercase alias used to select an account in GitHub Actions."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]+(?:-[a-z0-9]+)*$", var.account_alias))
    error_message = "account_alias must use lowercase letters, digits, and single hyphens."
  }
}

variable "aws_region" {
  description = "AWS Region for CrewSafe infrastructure."
  type        = string
  default     = "ap-southeast-1"

  validation {
    condition     = var.aws_region == "ap-southeast-1"
    error_message = "CrewSafe Terraform state must be provisioned in ap-southeast-1."
  }
}

variable "access_log_expiration_days" {
  description = "Days after which a self-delivered access-log object in the state bucket's own access-logs/ prefix is expired (SCRUM-443, terraform:S6258)."
  type        = number
  default     = 30

  validation {
    condition     = var.access_log_expiration_days > 0
    error_message = "access_log_expiration_days must be a positive number of days."
  }
}
