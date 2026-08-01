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

variable "cors_allowed_origins" {
  description = "Origins the deployed API accepts cross-origin requests from. Deliberately has no default: the application's own default is a list of localhost development servers, which must never reach a deployed environment."
  type        = list(string)
  default     = []
  validation {
    condition     = length(var.cors_allowed_origins) > 0
    error_message = "cors_allowed_origins must name at least one origin; a deployed environment must not inherit the application's localhost defaults."
  }
  validation {
    # An origin is scheme + host + optional port. A path, a trailing slash, or a
    # query string is not an origin and will never match a browser's Origin header.
    # http:// is rejected outright: it would let a network attacker read the tokens
    # the browser attaches to a cross-origin request.
    condition = alltrue([
      for origin in var.cors_allowed_origins :
      can(regex("^https://[a-zA-Z0-9][a-zA-Z0-9.-]*(?::[0-9]{1,5})?$", origin))
    ])
    error_message = "Every entry in cors_allowed_origins must be an https:// origin with no path, no trailing slash, and no query string."
  }
}

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
