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
  description = "Region the shared development database is provisioned in."
  type        = string
  default     = "ap-southeast-1"
  validation {
    condition     = var.aws_region == "ap-southeast-1"
    error_message = "The shared development deployment is restricted to ap-southeast-1."
  }
}

# ---------------------------------------------------------------------------
# There is NO password variable here, and there never may be (FR-012).
#
# The managed database service generates, stores, and rotates the master
# credential; no Terraform component holds the value. Because no variable can
# carry one, a committed tfvars file could not supply a credential even by
# mistake. The absence is the mechanism, so it is asserted mechanically by
# .github/scripts/terraform/tests/test-database-source-guard.sh rather than left
# to reviewer memory.
# ---------------------------------------------------------------------------

variable "engine_major_version" {
  description = "PostgreSQL MAJOR version only, e.g. \"16\". Deliberately not a minor version: auto_minor_version_upgrade is on (FR-041), and a pinned minor would make every plan after an automatic upgrade propose reverting it."
  type        = string
  default     = "16"
  validation {
    condition     = can(regex("^[0-9]+$", var.engine_major_version))
    error_message = "engine_major_version must be a major version number only (for example \"16\"), with no minor component."
  }
}

variable "instance_class" {
  description = "RDS instance class. A revisable starting point rather than a measured result (PERF-004): no representative workload exists until the compute runtime deploys, and resizing is a routine plan-and-apply."
  type        = string
  default     = "db.t4g.micro"
  validation {
    condition     = can(regex("^db\\.[a-z0-9]+\\.[a-z]+$", var.instance_class))
    error_message = "instance_class must be a valid RDS instance class, for example db.t4g.micro."
  }
}

variable "allocated_storage" {
  description = "Initial storage in GiB. Twenty is the minimum RDS accepts for gp3; a smaller value is silently promoted, which would make the declared value a lie."
  type        = number
  default     = 20
  validation {
    condition     = var.allocated_storage >= 20 && var.allocated_storage <= 500
    error_message = "allocated_storage must be between 20 (the gp3 minimum) and 500 GiB."
  }
}

variable "max_allocated_storage" {
  description = "Ceiling for automatic storage growth, in GiB (FR-036). Growth is automatic up to this point; beyond it writes fail, deliberately, so a runaway migration or seeding defect stops rather than billing indefinitely."
  type        = number
  default     = 100
  validation {
    # A ceiling at or below the initial allocation disables autoscaling entirely,
    # which contradicts FR-036's first half. An absent ceiling contradicts its
    # second half. Both are refused here rather than discovered in production.
    condition     = var.max_allocated_storage > var.allocated_storage && var.max_allocated_storage <= 500
    error_message = "max_allocated_storage must exceed allocated_storage and stay at or below 500 GiB."
  }
}

variable "backup_retention_days" {
  description = "Days of automated backups retained (FR-024). Seven is the floor this component accepts; zero disables backups entirely."
  type        = number
  default     = 7
  validation {
    condition     = var.backup_retention_days >= 7 && var.backup_retention_days <= 35
    error_message = "backup_retention_days must be between 7 and 35; a shorter window does not satisfy FR-024, and 0 disables automated backups."
  }
}
