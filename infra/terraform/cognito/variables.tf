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
  description = "Exact immutable owner/repository-ID OIDC subject issued for this repository's main branch."
  type        = string
  validation {
    condition     = can(regex("^repo:[A-Za-z0-9_.-]+@[0-9]+/[A-Za-z0-9_.-]+@[0-9]+:ref:refs/heads/main$", var.github_oidc_main_subject))
    error_message = "github_oidc_main_subject must be the exact immutable owner/repository-ID main-branch subject without wildcards."
  }
}

variable "web_callback_urls" {
  type    = list(string)
  default = [
    "http://localhost:5173/callback",
    "https://d3b75ru76gta2n.cloudfront.net/callback",
  ]
  validation {
    condition = var.web_callback_urls == tolist([
      "http://localhost:5173/callback",
      "https://d3b75ru76gta2n.cloudfront.net/callback",
    ])
    error_message = "The shared development web client has exactly the reviewed localhost and staging callbacks."
  }
}
variable "web_logout_urls" {
  type    = list(string)
  default = [
    "http://localhost:5173/",
    "https://d3b75ru76gta2n.cloudfront.net/",
  ]
  validation {
    condition = var.web_logout_urls == tolist([
      "http://localhost:5173/",
      "https://d3b75ru76gta2n.cloudfront.net/",
    ])
    error_message = "The shared development web client has exactly the reviewed localhost and staging logout URLs."
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
