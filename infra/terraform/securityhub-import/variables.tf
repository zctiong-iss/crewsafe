variable "expected_account_id" {
  description = "Twelve-digit approved account for the importer role."
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
    error_message = "account_alias must be a lowercase slug."
  }
}

variable "aws_region" {
  description = "The only region permitted for Security Hub imports."
  type        = string
  default     = "ap-southeast-1"
  validation {
    condition     = var.aws_region == "ap-southeast-1"
    error_message = "Security Hub imports are restricted to ap-southeast-1."
  }
}

variable "github_oidc_main_subject" {
  description = "Exact immutable GitHub OIDC main-branch subject."
  type        = string
  validation {
    condition     = can(regex("^repo:[A-Za-z0-9_.-]+@[0-9]+/[A-Za-z0-9_.-]+@[0-9]+:ref:refs/heads/main$", var.github_oidc_main_subject))
    error_message = "github_oidc_main_subject must be the exact immutable main-branch subject."
  }
}
