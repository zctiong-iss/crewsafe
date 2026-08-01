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
  description = "Region the shared development secrets and roles are provisioned in."
  type        = string
  default     = "ap-southeast-1"
  validation {
    condition     = var.aws_region == "ap-southeast-1"
    error_message = "The shared development deployment is restricted to ap-southeast-1."
  }
}

variable "database_username" {
  description = "PostgreSQL master user the application connects as. Non-secret: the password is held by the managed database service (FR-029), never here."
  type        = string
  default     = "crewsafe"
  validation {
    condition     = can(regex("^[a-z_][a-z0-9_]{0,62}$", var.database_username))
    error_message = "database_username must be a lowercase PostgreSQL identifier starting with a letter or underscore, at most 63 characters."
  }
  validation {
    # RDS rejects rdsadmin at creation, and postgres invites confusion with the
    # default database. Failing here turns a mid-apply error into a validation error.
    condition     = !contains(["postgres", "rdsadmin"], var.database_username)
    error_message = "database_username must not be a reserved name (postgres, rdsadmin)."
  }
}

# cors_allowed_origins is deliberately NOT a variable here.
#
# The permitted origin is the web application's own public address, which does not
# exist yet — nothing in this project has a deployed origin, and the shared Cognito
# pool's only reviewed web callback is http://localhost:5173/callback. A required
# input whose value nobody can supply makes the component unappliable; a committed
# placeholder is the pattern FR-031 exists to reject, and a wrong CORS origin is
# either a broken application or an over-permissive one.
#
# So the entry follows the same rule as the database URL: the component that
# creates the web origin declares /crewsafe/shared-dev/cors/allowed-origins under
# the prefix this component publishes. See the obligations list in the runbook.

variable "secret_recovery_window_days" {
  description = "Days a deleted secret stays recoverable before permanent removal. Seven is the minimum AWS permits above immediate deletion (R-006)."
  type        = number
  default     = 7
  validation {
    # 0 means immediate, irreversible deletion. FR-007 requires a recovery window,
    # so the type system enforces it rather than a convention nobody rereads.
    condition     = var.secret_recovery_window_days >= 7 && var.secret_recovery_window_days <= 30
    error_message = "secret_recovery_window_days must be between 7 and 30; 0 (immediate deletion) is not permitted."
  }
}
