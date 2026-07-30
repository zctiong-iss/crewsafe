variable "expected_account_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.expected_account_id))
    error_message = "expected_account_id must contain exactly 12 digits."
  }
}

variable "account_alias" {
  type = string
  validation {
    condition     = can(regex("^[a-z0-9]+(?:-[a-z0-9]+)*$", var.account_alias))
    error_message = "account_alias must be a lowercase slug."
  }
}

variable "aws_region" {
  type    = string
  default = "ap-southeast-1"
  validation {
    condition     = var.aws_region == "ap-southeast-1"
    error_message = "Shared development Cognito is restricted to ap-southeast-1."
  }
}

variable "github_oidc_main_subject" {
  description = "Exact non-wildcard OIDC subject issued for this repository's main branch."
  type        = string
  validation {
    condition     = can(regex("^repo:[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+:ref:refs/heads/main$", var.github_oidc_main_subject))
    error_message = "github_oidc_main_subject must be an exact main-branch subject without wildcards."
  }
}

variable "web_callback_urls" {
  type    = list(string)
  default = ["http://localhost:5173/callback"]
  validation {
    condition     = var.web_callback_urls == tolist(["http://localhost:5173/callback"])
    error_message = "The shared development web client has one reviewed localhost callback."
  }
}
variable "web_logout_urls" {
  type    = list(string)
  default = ["http://localhost:5173/"]
  validation {
    condition     = var.web_logout_urls == tolist(["http://localhost:5173/"])
    error_message = "The shared development web client has one reviewed localhost logout URL."
  }
}
variable "mobile_callback_urls" {
  type    = list(string)
  default = ["crewsafe://callback"]
  validation {
    condition     = var.mobile_callback_urls == tolist(["crewsafe://callback"])
    error_message = "The shared development mobile client has one reviewed callback."
  }
}
variable "mobile_logout_urls" {
  type    = list(string)
  default = ["crewsafe://"]
  validation {
    condition     = var.mobile_logout_urls == tolist(["crewsafe://"])
    error_message = "The shared development mobile client has one reviewed logout URL."
  }
}
