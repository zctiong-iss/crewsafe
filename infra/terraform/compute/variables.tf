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
  description = "Region the shared development compute runtime is provisioned in."
  type        = string
  default     = "ap-southeast-1"
  validation {
    condition     = var.aws_region == "ap-southeast-1"
    error_message = "The shared development deployment is restricted to ap-southeast-1."
  }
}

# ---------------------------------------------------------------------------
# Every variable below this line has a default, and that is a requirement rather
# than a convenience (FR-047).
#
# The shared plan and apply workflows pass exactly four TF_VAR_* values —
# expected_account_id, account_alias, aws_region, and github_oidc_main_subject —
# and offer no mechanism for a per-component input. A variable without a default
# could therefore never be supplied, so the component could never be planned.
#
# That constraint is what produced this component's deployment model: Terraform
# owns the infrastructure and CI owns the deployment (see the ignore_changes block
# on aws_ecs_service in main.tf).
# ---------------------------------------------------------------------------

variable "initial_image_tag" {
  description = <<-EOT
    Image tag Terraform names in the INITIAL task definition. Read only when that task
    definition is first created — every revision after it belongs to SCRUM-145, which
    deploys with force-new-deployment rather than a Terraform apply. A stale value here
    therefore does not govern what is running, and ignore_changes keeps a later apply from
    disturbing the service.

    The value must be the commit SHA of an image SCRUM-177's publish job has ALREADY pushed.
    The validation cannot check that — any 40 hex characters satisfy it, including a
    placeholder that names nothing — so a wrong value here survives validate, test, the
    source guard, and a clean plan, and first surfaces as an image-pull failure after a
    complete apply. The default below is a real published tag for exactly that reason.

    The validation rejects `latest` deliberately: a mutable tag makes a rollback ambiguous,
    and re-pushing the same tag does not by itself cause a task to be replaced.
  EOT
  type        = string

  # Merge commit for #52, published to crewsafe/backend by Backend CI run 30793342633
  # (digest sha256:cadab448069f94a1480e50645d97bf47678537f1820556141b0aec2231796905).
  #
  # This is a default rather than a dispatch input because the shared plan and apply
  # workflows pass exactly four TF_VAR_* values, none of them per-component — so there is no
  # override path and this committed value IS the value the first task definition gets.
  #
  # It does not need updating as the backend moves on: it is read once, at initial task
  # definition creation, after which ignore_changes hands the deployed image to SCRUM-145.
  # It does need to still EXIST in the registry when the first apply runs — SCRUM-177 retains
  # the newest twenty images, so re-pin if twenty pushes land before that apply.
  default = "af7727812ee82bb74afc172fa6e5d4b865752152"
  validation {
    condition     = can(regex("^[0-9a-f]{7,40}$", var.initial_image_tag))
    error_message = "initial_image_tag must be a commit SHA: 7 to 40 lowercase hexadecimal characters. 'latest' and branch names are rejected."
  }
}

variable "task_cpu" {
  description = "Fargate CPU units for the task. 512 is the smallest allocation that starts this application without the cold start dominating the health grace period."
  type        = number
  default     = 512
  validation {
    condition     = contains([256, 512, 1024, 2048, 4096], var.task_cpu)
    error_message = "task_cpu must be a valid Fargate CPU value: 256, 512, 1024, 2048, or 4096."
  }
}

variable "task_memory" {
  description = "Fargate memory (MiB) for the task. A JVM with JPA, Flyway, and a resource-server filter chain needs more than 512 MiB to start comfortably."
  type        = number
  default     = 1024
  validation {
    condition     = var.task_memory >= 512 && var.task_memory <= 30720 && var.task_memory % 256 == 0
    error_message = "task_memory must be between 512 and 30720 MiB and a multiple of 256."
  }
}

variable "desired_count" {
  description = "Running tasks. One is accepted for a shared development environment; the load balancer spans both private subnets so raising this needs no structural change. Ignored after creation — see the service's ignore_changes."
  type        = number
  default     = 1
  validation {
    condition     = var.desired_count >= 0 && var.desired_count <= 4
    error_message = "desired_count must be between 0 and 4 for the shared development deployment."
  }
}

variable "health_check_grace_period_seconds" {
  description = <<-EOT
    How long the service waits before letting a failed health check kill a starting task.

    This MUST exceed migrations plus application context startup. If it does not, the
    platform kills the task mid-migration and retries forever, which presents as a health
    check failure rather than a timing problem and leaves a partially applied migration
    behind each time.

    180 is an ESTIMATE. Measure the real cold start on the first apply — the elapsed time
    between the first Flyway log line and "Started CrewSafeApplication" — and set this to
    roughly twice the total.
  EOT
  type        = number
  default     = 180
  validation {
    condition     = var.health_check_grace_period_seconds >= 30 && var.health_check_grace_period_seconds <= 1800
    error_message = "health_check_grace_period_seconds must be between 30 and 1800."
  }
}

variable "log_retention_days" {
  description = "Retention for the application log group. Fourteen rather than the database component's seven: this log is the only diagnosis path for a failed deploy or migration, and a seven-day window can expire the evidence before the sprint's retrospective."
  type        = number
  default     = 14
  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365], var.log_retention_days)
    error_message = "log_retention_days must be a retention period CloudWatch Logs accepts."
  }
}

variable "cors_allowed_origins" {
  description = <<-EOT
    Browser origins permitted to call the API, as the application's CORS_ALLOWED_ORIGINS.

    These are CALLER origins, not this service's own URL — a same-origin request is not
    subject to cross-origin checks, so naming the staging backend here would permit nothing.
    The default is the application's own local development origins, which keeps the staging
    API callable from a developer's browser while no browser client is deployed.

    Whichever issue deploys the web client replaces this with its real origin.
  EOT
  type        = string
  default     = "http://localhost:5173,http://localhost:8081"
  validation {
    condition     = length(trimspace(var.cors_allowed_origins)) > 0 && !can(regex("\\*", var.cors_allowed_origins))
    error_message = "cors_allowed_origins must be a non-empty explicit list of origins and must not contain a wildcard."
  }
}
