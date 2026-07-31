variable "expected_account_id" {
  description = "Twelve-digit AWS account the caller must be authenticated against. Supplied at dispatch; never committed."
  type        = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.expected_account_id))
    error_message = "expected_account_id must contain exactly 12 digits."
  }
}

variable "account_alias" {
  description = "Alias of the target account, used in resource naming and dispatch traceability."
  type        = string
  validation {
    condition     = can(regex("^[a-z0-9]+(?:-[a-z0-9]+)*$", var.account_alias))
    error_message = "account_alias must be a lowercase slug."
  }
}

variable "aws_region" {
  description = "Region the shared development network is provisioned in."
  type        = string
  default     = "ap-southeast-1"
  validation {
    condition     = var.aws_region == "ap-southeast-1"
    error_message = "The shared development network is restricted to ap-southeast-1."
  }
}

variable "availability_zones" {
  description = "The two availability zones the network spans. Pinned rather than discovered so plan output and tests stay deterministic."
  type        = list(string)
  default     = ["ap-southeast-1a", "ap-southeast-1b"]
  validation {
    condition     = length(var.availability_zones) == 2
    error_message = "availability_zones must contain exactly two zones."
  }
  validation {
    condition     = alltrue([for zone in var.availability_zones : can(regex("^ap-southeast-1[a-z]$", zone))])
    error_message = "Every availability zone must be within ap-southeast-1."
  }
  validation {
    condition     = length(distinct(var.availability_zones)) == length(var.availability_zones)
    error_message = "availability_zones must not repeat a zone."
  }
}

variable "vpc_cidr_block" {
  description = "Private address range for the network, subdivided into per-tier, per-zone /24 blocks."
  type        = string
  default     = "10.0.0.0/16"
  validation {
    condition     = can(cidrhost(var.vpc_cidr_block, 0))
    error_message = "vpc_cidr_block must be a valid CIDR block."
  }
  validation {
    # try() rather than && : Terraform evaluates both operands, so a value with
    # no "/" raises an index error instead of failing validation cleanly.
    condition = try(
      tonumber(split("/", var.vpc_cidr_block)[1]) >= 16
      && tonumber(split("/", var.vpc_cidr_block)[1]) <= 20,
      false
    )
    error_message = "vpc_cidr_block must use a prefix between /16 and /20 so the per-tier /24 subnets fit."
  }
}

variable "database_port" {
  description = "The single port the database security group admits. Pinned to PostgreSQL's default; widening it is the regression this component exists to prevent."
  type        = number
  default     = 5432
  validation {
    condition     = var.database_port == 5432
    error_message = "The database boundary admits PostgreSQL on 5432 only."
  }
}
