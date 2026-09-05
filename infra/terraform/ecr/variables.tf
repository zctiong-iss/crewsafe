# Author: Jemilin Beulah

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
  description = "Region the shared development container registry and push role are provisioned in."
  type        = string
  default     = "ap-southeast-1"
  validation {
    condition     = var.aws_region == "ap-southeast-1"
    error_message = "The shared development deployment is restricted to ap-southeast-1."
  }
}

variable "github_oidc_main_subject" {
  description = "Exact owner/repository-ID OIDC subject for this repo's main branch, so only a workflow run on main can assume the push role."
  type        = string
  validation {
    condition     = can(regex("^repo:[A-Za-z0-9_.-]+@[0-9]+/[A-Za-z0-9_.-]+@[0-9]+:ref:refs/heads/main$", var.github_oidc_main_subject))
    error_message = "github_oidc_main_subject must be the exact immutable owner/repository-ID main-branch subject without wildcards."
  }
}

# Decommissioning switch. Defaults to false so every guard this root normally
# carries stays in force; nothing about a routine plan or apply changes. It is
# set to true only by a deliberate teardown dispatch (the `decommission` input
# on Terraform Plan), which lowers the deletion protections that would
# otherwise refuse the destroy at the AWS service itself.
#
# Two independent refusals still stand in front of this: the component
# catalogue's allow_destroy, and the typed DESTROY confirmation on Terraform
# Apply. This only removes the third.
variable "decommission" {
  description = "Lower this component's deletion protections for a reviewed teardown. Never true for normal operation."
  type        = bool
  default     = false
}
