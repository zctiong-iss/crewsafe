variable "expected_account_id" {
  description = "Twelve-digit AWS account the caller must be authenticated against. Supplied at dispatch; never committed."
  type        = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.expected_account_id))
    error_message = "expected_account_id must contain exactly 12 digits."
  }
}

variable "account_alias" {
  description = "Alias of the target account, used in dispatch traceability."
  type        = string
  validation {
    condition     = can(regex("^[a-z0-9]+(?:-[a-z0-9]+)*$", var.account_alias))
    error_message = "account_alias must be a lowercase slug."
  }
}

variable "aws_region" {
  description = "Region the developer IAM group, policy, and users are provisioned in."
  type        = string
  default     = "ap-southeast-1"
  validation {
    condition     = var.aws_region == "ap-southeast-1"
    error_message = "The shared development deployment is restricted to ap-southeast-1."
  }
}

variable "developers" {
  description = "Current developer roster. Sourced from the committed developers.auto.tfvars, reviewed like any other change (research.md R-003) — never typed in at CI dispatch time."
  type = list(object({
    username = string
  }))
  validation {
    # Both AWS's IAM username charset and the project's stricter lowercase-slug convention
    # (matching account_alias's style) must hold for every entry.
    condition = alltrue([
      for d in var.developers :
      can(regex("^[A-Za-z0-9+=,.@_-]{1,64}$", d.username)) &&
      can(regex("^[a-z0-9]+(-[a-z0-9]+)*$", d.username))
    ])
    error_message = "Every developer username must be a lowercase slug (matches AWS's IAM username charset and the project's account_alias convention)."
  }
}
