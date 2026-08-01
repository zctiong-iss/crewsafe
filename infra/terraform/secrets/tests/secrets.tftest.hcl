# Infrastructure tests for the crewsafe shared-dev secrets and IAM component (SCRUM-174).
#
# Every run block plans against a mocked provider, so no AWS account, credential,
# or network call is involved. The IAM assertions in "iam_boundary" are the
# load-bearing controls: this component's entire purpose is that the two published
# identities can read exactly its own entries and nothing else, and a widened
# resource scope is the single most likely regression in an IAM policy.
#
# The IAM assertions decode the policy JSON actually attached to each role, not a
# local. That is stricter than reading the local: it is the document that would
# really be sent to AWS. It works under a mocked provider only because the policy
# is a jsonencode() of configuration rather than a rendered
# data "aws_iam_policy_document", whose json attribute the mock would fabricate —
# every assertion would then be checking invented data and passing meaninglessly
# (research.md R-004).

mock_provider "aws" {}

# The mocked provider fabricates a random account id, which would trip the
# secret's account precondition in every run. Pin it once here so each run
# exercises what it is actually about; "rejects_mismatched_account" varies
# expected_account_id against this fixed identity to prove the precondition
# still bites.
override_data {
  target = data.aws_caller_identity.current
  values = { account_id = "123456789012" }
}

# terraform_remote_state belongs to the built-in terraform provider, NOT the aws
# provider, so mock_provider "aws" does not cover it. Without this override the
# test attempts a real S3 read and fails offline (research.md R-009).
override_data {
  target = data.terraform_remote_state.cognito
  values = {
    outputs = {
      issuer_uri       = "https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_TEST00000"
      jwks_uri         = "https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_TEST00000/.well-known/jwks.json"
      web_client_id    = "webclientid0000000000000000"
      mobile_client_id = "mobileclientid000000000000"
      cli_client_id    = "cliclientid0000000000000000"
    }
  }
}

# ARNs are assigned by AWS, so under a mocked provider they are fabricated as
# arbitrary strings. Pinning them makes the published contract's shape assertable
# — in particular that a consumer receives a real secret ARN including the
# six-character suffix Secrets Manager appends, which a policy resource pattern
# must account for. Same technique the network component uses for resource ids.
override_resource {
  target = aws_secretsmanager_secret.weather_api_key
  values = {
    arn = "arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:crewsafe/shared-dev/weather-api-key-AbCdEf"
  }
}

override_resource {
  target = aws_iam_role.task_execution
  values = {
    arn = "arn:aws:iam::123456789012:role/crewsafe-shared-dev-task-execution"
  }
}

override_resource {
  target = aws_iam_role.task
  values = {
    arn = "arn:aws:iam::123456789012:role/crewsafe-shared-dev-task"
  }
}

variables {
  expected_account_id  = "123456789012"
  account_alias        = "shared-dev"
  aws_region           = "ap-southeast-1"
  database_username    = "crewsafe"
  cors_allowed_origins = ["https://crewsafe.example.com"]
}

# ---------------------------------------------------------------------------
# Input validation (SEC-002) — every dispatch input is untrusted.
# ---------------------------------------------------------------------------

run "rejects_malformed_account_id" {
  command = plan
  variables {
    expected_account_id = "12345"
  }
  expect_failures = [var.expected_account_id]
}

run "rejects_region_outside_ap_southeast_1" {
  command = plan
  variables {
    aws_region = "us-east-1"
  }
  expect_failures = [var.aws_region]
}

run "rejects_non_slug_account_alias" {
  command = plan
  variables {
    account_alias = "Not_An_Alias"
  }
  expect_failures = [var.account_alias]
}

# RDS reserves rdsadmin and rejects it at creation; postgres invites confusion
# with the default database. Catching both here turns a mid-apply failure into a
# validation error — the same class of fix as SCRUM-173's description charset
# assertion.
run "rejects_reserved_database_username_rdsadmin" {
  command = plan
  variables {
    database_username = "rdsadmin"
  }
  expect_failures = [var.database_username]
}

run "rejects_reserved_database_username_postgres" {
  command = plan
  variables {
    database_username = "postgres"
  }
  expect_failures = [var.database_username]
}

run "rejects_database_username_invalid_leading_character" {
  command = plan
  variables {
    database_username = "9crewsafe"
  }
  expect_failures = [var.database_username]
}

# The application's own default for this setting is a list of localhost
# development servers. An empty list here must fail rather than silently
# deploying with no origins configured.
run "rejects_empty_cors_allowed_origins" {
  command = plan
  variables {
    cors_allowed_origins = []
  }
  expect_failures = [var.cors_allowed_origins]
}

# A staging origin served over plain HTTP would let a network attacker read the
# tokens the browser attaches to a cross-origin request.
run "rejects_insecure_cors_origin" {
  command = plan
  variables {
    cors_allowed_origins = ["http://crewsafe.example.com"]
  }
  expect_failures = [var.cors_allowed_origins]
}

run "rejects_cors_origin_with_path" {
  command = plan
  variables {
    cors_allowed_origins = ["https://crewsafe.example.com/api"]
  }
  expect_failures = [var.cors_allowed_origins]
}

# 0 means immediate, irreversible deletion. FR-007 requires a recovery window,
# and enforcing it in the type system is cheaper than enforcing it by convention.
run "rejects_zero_secret_recovery_window" {
  command = plan
  variables {
    secret_recovery_window_days = 0
  }
  expect_failures = [var.secret_recovery_window_days]
}

# ---------------------------------------------------------------------------
# US1 — the entries themselves (FR-002, FR-004, FR-007, FR-008)
#
# These runs use `command = apply` against the mocked provider: on Terraform
# 1.10.5 (the version CI pins) overrides are not surfaced during the plan phase,
# and the `override_during` argument that would change that does not exist until
# a later release. A mocked apply creates nothing — it resolves computed values
# so the assertions can run.
# ---------------------------------------------------------------------------

run "entry_shape" {
  command = apply

  assert {
    condition     = aws_secretsmanager_secret.weather_api_key.recovery_window_in_days == var.secret_recovery_window_days
    error_message = "The secret must keep a deletion recovery window so an accidental removal is recoverable (FR-007)."
  }

  assert {
    condition     = startswith(aws_secretsmanager_secret.weather_api_key.name, "crewsafe/shared-dev/")
    error_message = "The secret must be named inside this component's naming scope, or the read policy will not reach it (FR-004)."
  }

  # Seven, not thirteen: a value earns an entry only where the deployment must
  # differ from the application's own default (FR-001, research.md R-008).
  assert {
    condition     = length(aws_ssm_parameter.config) == 7
    error_message = "The configuration entry set changed. Adding one is fine; restating an application default is not (FR-001)."
  }

  # SecureString would hold the value in state and would obscure which entries
  # are actually sensitive (FR-003).
  assert {
    condition     = alltrue([for p in values(aws_ssm_parameter.config) : p.type == "String"])
    error_message = "Every configuration parameter must be a plain String; secrets belong in the secret store (FR-002, FR-003)."
  }

  assert {
    condition     = alltrue([for p in values(aws_ssm_parameter.config) : startswith(p.name, "/crewsafe/shared-dev/")])
    error_message = "Every parameter must live under the published prefix, or the read policy will not reach it (FR-004)."
  }

  # FR-008 — a reviewer must be able to audit intent without external context.
  assert {
    condition = (
      aws_secretsmanager_secret.weather_api_key.description != null
      && aws_secretsmanager_secret.weather_api_key.description != ""
      && alltrue([for p in values(aws_ssm_parameter.config) : p.description != null && p.description != ""])
    )
    error_message = "Every entry must describe what it holds, who writes it, and who reads it (FR-008)."
  }

  # The database URL is absent by design: its value does not exist until SCRUM-175
  # creates the database, and FR-031 gives the entry to the producing component
  # rather than declaring a placeholder here.
  assert {
    condition     = !contains(keys(aws_ssm_parameter.config), "db/url")
    error_message = "The database URL entry belongs to the database component, not here (FR-031)."
  }
}

# FR-021 / SC-010 — a dispatch against an account other than the designated one
# must fail before anything is created. The precondition is cheap; proving it
# bites is the point.
run "rejects_mismatched_account" {
  command = plan

  variables {
    expected_account_id = "999999999999"
  }

  expect_failures = [aws_secretsmanager_secret.weather_api_key]
}

# ---------------------------------------------------------------------------
# US2 — the permission boundary (FR-010 to FR-015, FR-029, FR-032)
#
# These are the load-bearing controls. A correctly stored secret behind an
# over-broad role is not protected, and a widened resource scope is the single
# most likely regression in an IAM policy.
#
# The assertions decode the policy JSON actually attached to the role rather
# than reading a local. That is stricter than asserting the local: it is the
# document that would really be sent to AWS. It works under a mocked provider
# only because the policy is a jsonencode() of configuration rather than a
# provider-computed aws_iam_policy_document, whose json attribute the mock would
# fabricate (research.md R-004).
# ---------------------------------------------------------------------------

run "iam_boundary" {
  command = apply

  # SC-006 — absolute: no statement touching a secret or a parameter may use a
  # resource wildcard. FR-032's exemption covers a registry action only.
  assert {
    condition = alltrue([
      for s in concat(
        jsondecode(aws_iam_role_policy.task_execution.policy).Statement,
        jsondecode(aws_iam_role_policy.task.policy).Statement
      ) : s.Resource != "*"
      if length([for a in s.Action : a if startswith(a, "secretsmanager:") || startswith(a, "ssm:")]) > 0
    ])
    error_message = "A statement granting a secret or parameter action uses a resource wildcard (SC-006, FR-011)."
  }

  # SC-007 — both identities are read-only. A write permission on a secret would
  # let the application overwrite the credential it authenticates with.
  assert {
    condition = alltrue([
      for s in concat(
        jsondecode(aws_iam_role_policy.task_execution.policy).Statement,
        jsondecode(aws_iam_role_policy.task.policy).Statement
        ) : alltrue([
          for a in s.Action :
          !(
            (startswith(a, "secretsmanager:") || startswith(a, "ssm:")) &&
            length([for verb in ["Put", "Create", "Delete", "Update", "Tag", "Untag", "Restore"] : verb if strcontains(a, verb)]) > 0
          )
      ])
    ])
    error_message = "An identity holds a write, delete, or tag permission on a secret or parameter (SC-007, FR-012)."
  }

  # SC-014 — exactly one grant reaches outside this component's naming scope: the
  # service-managed database credential (FR-029), which cannot be pinned by ARN
  # because the service names it and it does not exist until the database does.
  # Every other resource ARN mentions the project scope; the one documented
  # wildcard is excluded here and asserted separately by SC-016.
  assert {
    condition = length([
      for s in concat(
        jsondecode(aws_iam_role_policy.task_execution.policy).Statement,
        jsondecode(aws_iam_role_policy.task.policy).Statement
      ) : s.Sid
      if s.Resource != "*" && !strcontains(s.Resource, "crewsafe")
    ]) == 2
    error_message = "The number of grants reaching outside this component's naming scope changed. Exactly one per role (the rds! service-managed credential path) is permitted (SC-014, FR-029)."
  }

  assert {
    condition = alltrue([
      for s in concat(
        jsondecode(aws_iam_role_policy.task_execution.policy).Statement,
        jsondecode(aws_iam_role_policy.task.policy).Statement
      ) : strcontains(s.Resource, ":secret:rds!")
      if s.Resource != "*" && !strcontains(s.Resource, "crewsafe")
    ])
    error_message = "A grant reaches outside this component's naming scope and is not the rds! service-managed credential path (SC-014, FR-029)."
  }

  # SC-016 — the one unavoidable wildcard. ecr:GetAuthorizationToken does not
  # support resource-level permissions; the service accepts only "*", which is
  # why the platform's own managed policy is written that way. Constrained here
  # to one statement holding one action so it cannot quietly acquire a sibling.
  assert {
    condition = length([
      for s in concat(
        jsondecode(aws_iam_role_policy.task_execution.policy).Statement,
        jsondecode(aws_iam_role_policy.task.policy).Statement
      ) : s.Sid if s.Resource == "*"
    ]) == 1
    error_message = "There must be exactly one statement using a full resource wildcard (SC-016, FR-032)."
  }

  assert {
    condition = alltrue([
      for s in concat(
        jsondecode(aws_iam_role_policy.task_execution.policy).Statement,
        jsondecode(aws_iam_role_policy.task.policy).Statement
      ) : length(s.Action) == 1 && s.Action[0] == "ecr:GetAuthorizationToken"
      if s.Resource == "*"
    ])
    error_message = "The single wildcard statement must hold exactly one action, and it must be ecr:GetAuthorizationToken (SC-016, FR-032)."
  }

  # FR-013 — neither role may be assumable by anything but the container runtime.
  assert {
    condition = alltrue([
      for doc in [
        jsondecode(aws_iam_role.task_execution.assume_role_policy),
        jsondecode(aws_iam_role.task.assume_role_policy)
        ] : alltrue([
          for s in doc.Statement :
          try(s.Principal.Service, null) == "ecs-tasks.amazonaws.com"
          && try(s.Principal.AWS, null) == null
          && s.Effect == "Allow"
      ])
    ])
    error_message = "Both roles must trust only ecs-tasks.amazonaws.com, with no wildcard principal and no external account (FR-013)."
  }

  # FR-010 — two distinct identities, not one used twice.
  assert {
    condition     = aws_iam_role.task_execution.name != aws_iam_role.task.name
    error_message = "The execution identity and the task identity must be separate roles (FR-010)."
  }

  # FR-010, FR-015 — the running application has no use for image-pull, log-write,
  # or parameter-read permissions. Granting them would make the separation cosmetic.
  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role_policy.task.policy).Statement : alltrue([
        for a in s.Action :
        !startswith(a, "ecr:") && !startswith(a, "logs:") && !startswith(a, "ssm:")
      ])
    ])
    error_message = "The task identity must hold secret reads only; image-pull, log-write, and parameter-read belong to the execution identity (FR-010, FR-015)."
  }

  # Every statement carries a Sid so a reviewer can name what they are looking at.
  assert {
    condition = alltrue([
      for s in concat(
        jsondecode(aws_iam_role_policy.task_execution.policy).Statement,
        jsondecode(aws_iam_role_policy.task.policy).Statement
      ) : try(s.Sid, "") != ""
    ])
    error_message = "Every policy statement must carry a Sid (FR-008)."
  }
}

# ---------------------------------------------------------------------------
# US3 — rotation without redeploying (FR-006, FR-007, FR-016)
#
# Most of this story is guaranteed by an absence the shell source guard enforces:
# no secret version resource, and no ignore_changes on a value. What is assertable
# here is that nothing this component publishes pins a version, because a pinned
# reference is what would silently make rotation require a task-definition change.
# ---------------------------------------------------------------------------

run "rotation_safety" {
  command = apply

  assert {
    condition = (
      var.secret_recovery_window_days >= 7
      && var.secret_recovery_window_days <= 30
    )
    error_message = "A deleted secret must stay recoverable; immediate deletion is not permitted (FR-007)."
  }

  # A consumer references this ARN in a task definition. If it carried a version
  # id or a stage suffix, ECS would resolve that fixed version forever and a
  # rotated value would never take effect (FR-016).
  assert {
    condition = (
      !strcontains(output.weather_api_key_secret_arn, ":AWSCURRENT")
      && !strcontains(output.weather_api_key_secret_arn, ":AWSPREVIOUS")
      && length(regexall("::[0-9a-f-]{36}$", output.weather_api_key_secret_arn)) == 0
    )
    error_message = "The published secret ARN must not pin a version or stage, or rotation stops taking effect (FR-016)."
  }
}

# ---------------------------------------------------------------------------
# US4 — the producer contract (FR-024)
#
# Output names and shapes are contractual: the database and compute components
# bind to these names and never to this component's internal resource addresses.
# ---------------------------------------------------------------------------

run "producer_contract" {
  command = apply

  assert {
    condition     = output.weather_api_key_secret_arn == aws_secretsmanager_secret.weather_api_key.arn
    error_message = "weather_api_key_secret_arn must expose the secret container's ARN (FR-024)."
  }

  # No trailing slash: consumers append "/name". Fixing this in the contract stops
  # two consumers disagreeing about whether to add one.
  assert {
    condition = (
      output.config_parameter_prefix == "/crewsafe/shared-dev"
      && !endswith(output.config_parameter_prefix, "/")
    )
    error_message = "config_parameter_prefix must be the published path with no trailing slash (FR-024)."
  }

  # Every parameter this component creates must sit under the prefix it publishes,
  # or a consumer following the contract will look in the wrong place.
  assert {
    condition = alltrue([
      for p in values(aws_ssm_parameter.config) :
      startswith(p.name, "${output.config_parameter_prefix}/")
    ])
    error_message = "A parameter falls outside the published prefix, so a consumer reading the contract would not find it (FR-024, FR-031)."
  }

  assert {
    condition = (
      output.task_execution_role_arn == aws_iam_role.task_execution.arn
      && output.task_role_arn == aws_iam_role.task.arn
      && output.task_execution_role_arn != output.task_role_arn
    )
    error_message = "Both role ARNs must be published and must be distinct (FR-010, FR-024)."
  }

  # Published so the database component can attach a precisely pinned credential
  # grant once the service-managed secret's real ARN exists, narrowing FR-029's
  # prefix grant after the fact.
  assert {
    condition     = output.task_execution_role_name == aws_iam_role.task_execution.name
    error_message = "task_execution_role_name must be published so a consumer can attach a pinned grant later (FR-024, FR-029)."
  }

  # FR-009 / SC-003 — no output may carry a credential. Every one is an identifier
  # or a path, which is also why none is marked sensitive: doing so would imply
  # these values need protecting and obscure that the real guarantee is elsewhere.
  assert {
    condition = alltrue([
      for v in [
        output.weather_api_key_secret_arn,
        output.config_parameter_prefix,
        output.task_execution_role_arn,
        output.task_role_arn,
        output.task_execution_role_name,
      ] : startswith(v, "arn:aws:") || startswith(v, "/crewsafe/") || startswith(v, "crewsafe-")
    ])
    error_message = "Every output must be an identifier or a path, never a value (FR-009, FR-024)."
  }
}
