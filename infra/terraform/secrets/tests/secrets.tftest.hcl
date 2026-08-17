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
      issuer_uri        = "https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_TEST00000"
      jwks_uri          = "https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_TEST00000/.well-known/jwks.json"
      web_client_id     = "webclientid0000000000000000"
      mobile_client_id  = "mobileclientid000000000000"
      cli_client_id     = "cliclientid0000000000000000"
      user_pool_id      = "ap-southeast-1_TEST00000"
      user_pool_arn     = "arn:aws:cognito-idp:ap-southeast-1:123456789012:userpool/ap-southeast-1_TEST00000"
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
  expected_account_id = "123456789012"
  account_alias       = "shared-dev"
  aws_region          = "ap-southeast-1"
  database_username   = "crewsafe"
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

  # Ten, not fourteen: a value earns an entry only where the deployment must
  # differ from the application's own default (FR-001, research.md R-008). The
  # two ml/model-manifest* entries (SCRUM-373, FR-008) are always declared
  # explicitly rather than absent — see the dedicated model_manifest_slots run
  # block below. cognito-admin/user-pool-id (ADR 0018) is the tenth: the pool id
  # CognitoUserProvisioningService.AdminCreateUser targets.
  assert {
    condition     = length(aws_ssm_parameter.config) == 10
    error_message = "The configuration entry set changed. Adding one is fine; restating an application default is not (FR-001)."
  }

  # SecureString would hold the value in state and would obscure which entries
  # are actually sensitive (FR-003).
  assert {
    condition     = alltrue([for p in values(aws_ssm_parameter.config) : p.type == "String"])
    error_message = "Every configuration parameter must be a plain String; secrets belong in the secret store (FR-002, FR-003)."
  }

  assert {
    condition = (
      aws_ssm_parameter.config["lightning/ingestion-enabled"].name == "/crewsafe/shared-dev/lightning/ingestion-enabled"
      && aws_ssm_parameter.config["lightning/ingestion-enabled"].value == "true"
      && strcontains(lower(aws_ssm_parameter.config["lightning/ingestion-enabled"].description), "lightning")
    )
    error_message = "Staging must publish the explicit lightning ingestion flag under the shared configuration prefix (SCRUM-444, FR-001)."
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

  # Both are absent by design: neither value exists until the component that
  # produces it does, and FR-031 gives the entry to that component rather than
  # declaring a placeholder here.
  assert {
    condition = (
      !contains(keys(aws_ssm_parameter.config), "db/url")
      && !contains(keys(aws_ssm_parameter.config), "cors/allowed-origins")
    )
    error_message = "db/url belongs to the database component and cors/allowed-origins to whatever creates the web origin; neither is declared here (FR-031)."
  }
}

# SCRUM-373, FR-008 — the model-manifest configuration slot. Originally
# declared holding the placeholder value "unset" (SSM rejects an actually-
# empty string — found live, secrets-shared-dev apply, 2026-08-15); promoted
# by SCRUM-114 (2026-08-16) to the checksum-pinned staging-demo bundle
# (ml-service/MODEL_CARD.md, docs/runbooks/SCRUM-373-ml-service-deploy.md
# #8.0) — the shared university-project staging demonstration only, not a
# production approval.
run "model_manifest_slots" {
  command = apply

  assert {
    condition     = contains(keys(aws_ssm_parameter.config), "ml/model-manifest")
    error_message = "A configuration slot for WBGT_MODEL_MANIFEST must exist (FR-008)."
  }

  assert {
    condition     = contains(keys(aws_ssm_parameter.config), "ml/model-manifest-sha256")
    error_message = "A configuration slot for WBGT_MODEL_MANIFEST_SHA256 must exist (FR-008)."
  }

  # Must be an absolute, in-image path — ForecastModelRegistry.from_environment()
  # (ml-service/crewsafe_ml/inference.py) resolves this value with
  # Path(value).resolve(strict=True), which resolves a relative path against
  # the process's own cwd, not image root. A relative value here would fail
  # silently (the same safe fallback "unset" took), not loudly, which is
  # exactly the mistake this assertion exists to catch before it ships.
  assert {
    condition     = startswith(aws_ssm_parameter.config["ml/model-manifest"].value, "/")
    error_message = "ml/model-manifest must be an absolute in-image path, or ForecastModelRegistry resolves it against the wrong working directory and silently fails to load (FR-008)."
  }

  # Pinned to the exact reviewed staging-demo bundle path/checksum
  # (ml-service/MODEL_CARD.md), so an accidental edit changes this test's
  # expectation rather than silently shipping a different, unreviewed bundle.
  assert {
    condition     = aws_ssm_parameter.config["ml/model-manifest"].value == "/app/model-bundle/staging-demo-v1/manifest.json"
    error_message = "ml/model-manifest must point at the reviewed staging-demo bundle path baked into the ml-service image (FR-008)."
  }

  assert {
    condition     = aws_ssm_parameter.config["ml/model-manifest-sha256"].value == "36ffe8e14f50025358dc633a6d331ea4583e3d378b3e72fc6bcaba7c66207031"
    error_message = "ml/model-manifest-sha256 must match the reviewed staging-demo manifest's own checksum (FR-008)."
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

  # SC-014 — a named, closed allow-list of grants reaching outside this
  # component's naming scope (generalized by SCRUM-373, research.md R-006, from
  # the original "exactly one per role, the rds! pattern" invariant SCRUM-174
  # established). Three families are permitted: the service-managed database
  # credential (FR-029, cannot be pinned by ARN — the service names it and it
  # does not exist until the database does), the four Bedrock model grants
  # (FR-006, contracts/bedrock-invoke-grant.md — a Bedrock model ARN carries no
  # "crewsafe" segment either, being an AWS/Anthropic-owned or account-scoped
  # resource, not one this component names), and the one Cognito user pool grant
  # (ADR 0018 — the pool is owned by the separate cognito-shared-dev component,
  # so its ARN is not "crewsafe"-scoped either). Every other resource ARN
  # mentions the project scope; the wildcard statements are excluded here and
  # asserted separately by SC-016.
  assert {
    condition = length([
      for s in concat(
        jsondecode(aws_iam_role_policy.task_execution.policy).Statement,
        jsondecode(aws_iam_role_policy.task.policy).Statement
      ) : s.Sid
      if s.Resource != "*" && !strcontains(s.Resource, "crewsafe")
    ]) == 7
    error_message = "The number of grants reaching outside this component's naming scope changed. Exactly one rds! grant per role, the four Bedrock model grants, and the one Cognito user pool grant on the task role, is permitted (SC-014, FR-029, FR-006, ADR 0018)."
  }

  assert {
    condition = alltrue([
      for s in concat(
        jsondecode(aws_iam_role_policy.task_execution.policy).Statement,
        jsondecode(aws_iam_role_policy.task.policy).Statement
      ) : strcontains(s.Resource, ":secret:rds!") || strcontains(s.Resource, ":bedrock:") || strcontains(s.Resource, ":userpool/")
      if s.Resource != "*" && !strcontains(s.Resource, "crewsafe")
    ])
    error_message = "A grant reaches outside this component's naming scope and is neither the rds! service-managed credential path, a Bedrock model ARN, nor the Cognito user pool ARN (SC-014, FR-029, FR-006, ADR 0018)."
  }

  # FR-006 — exactly four Bedrock statements: one for the Sonnet
  # mitigation-generation model, and three for the Haiku access-verification
  # model (the inference-profile ARN, plus BOTH representations of the
  # underlying foundation-model ARN AWS's authorization check has each
  # independently required across separate live calls — confirmed
  # 2026-08-15, research.md R-005, Rounds 1 through 3). Each grants only
  # bedrock:InvokeModel, never bedrock:*, never merged into one statement (a
  # list Resource would break the strcontains() checks above — research.md
  # R-006).
  assert {
    condition = length([
      for s in concat(
        jsondecode(aws_iam_role_policy.task_execution.policy).Statement,
        jsondecode(aws_iam_role_policy.task.policy).Statement
      ) : s.Sid
      if length([for a in s.Action : a if startswith(a, "bedrock:")]) > 0
    ]) == 4
    error_message = "There must be exactly four statements granting a bedrock: action (FR-006, contracts/bedrock-invoke-grant.md)."
  }

  # Confirmed live 2026-08-15, across three rounds: the underlying
  # foundation-model ARN a cross-region "global." inference profile is
  # authorized against does not consistently resolve to one canonical
  # resource shape — both the calling-region-scoped form and the region-less
  # form (arn:aws:bedrock:::foundation-model/...) have each independently
  # been the one a live AccessDeniedException named, on different calls for
  # the same model. Both statements must be present.
  assert {
    condition = anytrue([
      for s in jsondecode(aws_iam_role_policy.task.policy).Statement :
      s.Resource == "arn:aws:bedrock:${var.aws_region}::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0"
      if s.Sid == "InvokeBedrockAccessVerificationFoundationModel"
    ])
    error_message = "InvokeBedrockAccessVerificationFoundationModel must be scoped to the region-scoped foundation-model ARN — confirmed live (research.md R-005, Round 1 and Round 3)."
  }

  assert {
    condition = anytrue([
      for s in jsondecode(aws_iam_role_policy.task.policy).Statement :
      s.Resource == "arn:aws:bedrock:::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0"
      if s.Sid == "InvokeBedrockAccessVerificationFoundationModelGlobal"
    ])
    error_message = "InvokeBedrockAccessVerificationFoundationModelGlobal must be scoped to the region-less global foundation-model ARN — confirmed live (research.md R-005, Round 2) and per AWS's global-cross-region-inference IAM doc."
  }

  assert {
    condition = alltrue([
      for s in concat(
        jsondecode(aws_iam_role_policy.task_execution.policy).Statement,
        jsondecode(aws_iam_role_policy.task.policy).Statement
      ) : s.Action == ["bedrock:InvokeModel"]
      if length([for a in s.Action : a if startswith(a, "bedrock:")]) > 0
    ])
    error_message = "Every Bedrock statement must grant exactly bedrock:InvokeModel — never bedrock:*, never bundled with another action (FR-006)."
  }

  # FR-009 — this issue adds no S3 access anywhere on either identity.
  assert {
    condition = alltrue([
      for s in concat(
        jsondecode(aws_iam_role_policy.task_execution.policy).Statement,
        jsondecode(aws_iam_role_policy.task.policy).Statement
      ) : length([for a in s.Action : a if startswith(a, "s3:")]) == 0
    ])
    error_message = "Neither identity may hold any s3: action in this issue — a model bundle S3 fetch is explicitly deferred to a follow-up issue (FR-009)."
  }

  # SC-016 — exactly two unavoidable wildcards, named and closed (SCRUM-371,
  # research.md R-004). ecr:GetAuthorizationToken does not support
  # resource-level permissions; neither do the four ssmmessages channel actions
  # ECS Exec's SSM sidecar needs on the task role. Both are the platform's own
  # documented exceptions, not a gap in this component's scoping discipline.
  # Constrained to exactly these two statements so a third cannot quietly
  # acquire a wildcard alongside them.
  assert {
    condition = length([
      for s in concat(
        jsondecode(aws_iam_role_policy.task_execution.policy).Statement,
        jsondecode(aws_iam_role_policy.task.policy).Statement
      ) : s.Sid if s.Resource == "*"
    ]) == 2
    error_message = "There must be exactly two statements using a full resource wildcard (SC-016, FR-032, SCRUM-371 research.md R-004)."
  }

  assert {
    condition = alltrue([
      for s in concat(
        jsondecode(aws_iam_role_policy.task_execution.policy).Statement,
        jsondecode(aws_iam_role_policy.task.policy).Statement
        ) : contains([
          jsonencode(["ecr:GetAuthorizationToken"]),
          jsonencode(sort([
            "ssmmessages:CreateControlChannel",
            "ssmmessages:CreateDataChannel",
            "ssmmessages:OpenControlChannel",
            "ssmmessages:OpenDataChannel",
          ])),
      ], jsonencode(sort(s.Action)))
      if s.Resource == "*"
    ])
    error_message = "Every wildcard statement's action list must be exactly ecr:GetAuthorizationToken or exactly the four ssmmessages channel actions — no other wildcard statement is permitted (SC-016, FR-032, SCRUM-371 research.md R-004)."
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

  # SCRUM-191 FR-001, FR-002 — confused-deputy source conditions.
  #
  # Four assertions, not one loop over both roles. The assertion above deliberately
  # loops, and that is why it names neither role when it fails; these must name the
  # role AND the key, because the two roles are assumed at different moments in a
  # task's life and a failure has to say which one broke.
  #
  # Each reads the resource attribute rather than local.ecs_tasks_assume_role_policy:
  # the attribute is the document that would reach AWS, the local is an intermediate.
  # Same reasoning this file already records for the grant policies.
  #
  # Each compares the VALUE, not just the key's presence. A presence-only assertion
  # passes against a condition naming the wrong account, which is the failure mode
  # that would matter.
  #
  # The expected ARN is rebuilt here from the test's own variables rather than read
  # from local.ecs_source_arn_pattern. Referencing the local would be tautological:
  # changing the local changes both the policy and the expectation, so the assertion
  # would pass against any value including a wrong account. The first draft of these
  # assertions did exactly that and a mutation run caught it.
  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role.task_execution.assume_role_policy).Statement :
      try(s.Condition.ArnLike["aws:SourceArn"], null) == "arn:aws:ecs:${var.aws_region}:${var.expected_account_id}:*"
    ])
    error_message = "The EXECUTION role's trust policy must carry an ArnLike condition on aws:SourceArn naming this account and region (SCRUM-191 FR-001)."
  }

  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role.task.assume_role_policy).Statement :
      try(s.Condition.ArnLike["aws:SourceArn"], null) == "arn:aws:ecs:${var.aws_region}:${var.expected_account_id}:*"
    ])
    error_message = "The TASK role's trust policy must carry an ArnLike condition on aws:SourceArn naming this account and region (SCRUM-191 FR-002)."
  }

  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role.task_execution.assume_role_policy).Statement :
      try(s.Condition.StringEquals["aws:SourceAccount"], null) == var.expected_account_id
    ])
    error_message = "The EXECUTION role's trust policy must carry a StringEquals condition on aws:SourceAccount naming this account (SCRUM-191 FR-001)."
  }

  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role.task.assume_role_policy).Statement :
      try(s.Condition.StringEquals["aws:SourceAccount"], null) == var.expected_account_id
    ])
    error_message = "The TASK role's trust policy must carry a StringEquals condition on aws:SourceAccount naming this account (SCRUM-191 FR-002)."
  }

  # SCRUM-191 FR-032 — the strict operators, never the ...IfExists variants.
  #
  # ArnLikeIfExists and StringEqualsIfExists evaluate TRUE when the key is absent
  # from the request context. That removes the fail-closed risk and, with it, any
  # way to tell an enforced condition from an unenforced one: a healthy task would
  # prove nothing. A control that cannot be distinguished from its own absence is
  # close to no control, so the weaker form is forbidden rather than merely unused.
  assert {
    condition = alltrue([
      for doc in [
        jsondecode(aws_iam_role.task_execution.assume_role_policy),
        jsondecode(aws_iam_role.task.assume_role_policy)
        ] : alltrue([
          for s in doc.Statement :
          length([for op in keys(try(s.Condition, {})) : op if endswith(op, "IfExists")]) == 0
      ])
    ])
    error_message = "Neither trust policy may use an ...IfExists condition operator; it evaluates true on a missing key and makes the control unverifiable (SCRUM-191 FR-032, SC-023)."
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
