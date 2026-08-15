data "aws_caller_identity" "current" {}

# The identity component publishes the issuer, key-set, and client identifiers this
# application requires. Reading them here rather than re-declaring them means a
# change there cannot leave a stale copy behind (FR-019).
#
# The bucket name is derived, not configured: the convention lives in
# .github/scripts/terraform/resolve-terraform-account.sh:62 and is mirrored here.
# That is the one duplication this component accepts (research.md R-003) — changing
# it there without changing it here fails loudly at init rather than silently
# producing wrong values. The plan role already holds s3:GetObject on crewsafe/*,
# so no IAM change is required to read this.
data "terraform_remote_state" "cognito" {
  backend = "s3"
  config = {
    bucket = "crewsafe-terraform-state-${var.expected_account_id}-${var.aws_region}"
    key    = "crewsafe/cognito/shared-dev.tfstate"
    region = var.aws_region
  }
}

locals {
  name_prefix = "crewsafe-shared-dev"

  # One naming scope, in the form each store requires. This is what makes
  # "and nothing else" expressible in a permission policy: every grant below is
  # either an exact ARN under this scope, a wildcard under it, or one of the two
  # documented exceptions (FR-029, FR-032).
  secret_name_prefix    = "crewsafe/shared-dev"
  parameter_path_prefix = "/crewsafe/shared-dev"

  # Secrets Manager appends a six-character suffix to every secret ARN
  # (...:secret:crewsafe/shared-dev/weather-api-key-AbCdEf). A resource pattern
  # that stops at the name matches nothing — this is the most common way a
  # correct-looking secrets policy silently denies everything.
  secrets_arn_pattern    = "arn:aws:secretsmanager:${var.aws_region}:${var.expected_account_id}:secret:${local.secret_name_prefix}/*"
  parameters_arn_pattern = "arn:aws:ssm:${var.aws_region}:${var.expected_account_id}:parameter${local.parameter_path_prefix}/*"

  # FR-029 — the managed database service names its own secret (rds!db-<uuid>) and
  # it does not exist until the database does, so this grant cannot be a pinned ARN.
  # The rds! prefix is reserved by AWS: no customer secret can occupy it, which is
  # what bounds the grant. It is the ONLY grant in this component reaching outside
  # local.secret_name_prefix, and SC-014 asserts it stays that way.
  rds_managed_secret_arn_pattern = "arn:aws:secretsmanager:${var.aws_region}:${var.expected_account_id}:secret:rds!*"

  ecr_repository_arn_pattern = "arn:aws:ecr:${var.aws_region}:${var.expected_account_id}:repository/crewsafe/*"
  log_group_arn_pattern      = "arn:aws:logs:${var.aws_region}:${var.expected_account_id}:log-group:${local.parameter_path_prefix}/*"

  # SCRUM-191 — the source scope the two task identities may be assumed on behalf of.
  # Built from the same two variables as every pattern above, so there is one
  # definition of "which account and region" rather than two that can drift.
  #
  # The trailing :* is the documented form, not a placeholder awaiting a tighter
  # value. See the trust policy below for why it cannot be narrowed.
  ecs_source_arn_pattern = "arn:aws:ecs:${var.aws_region}:${var.expected_account_id}:*"

  cognito = data.terraform_remote_state.cognito.outputs

  # Eight entries. A value earns one only where the deployed environment must
  # differ from the default the application already carries (FR-001, research.md
  # R-008), or (the two ml/model-manifest* entries, SCRUM-373) where the
  # application has no default at all and the slot is deliberately declared
  # with a placeholder value rather than omitted (FR-008 — SSM rejects an
  # actually-empty string). The server port, the weather freshness
  # thresholds, the ingestion interval, and the external weather API base URL
  # all keep their application defaults and are deliberately absent.
  #
  # Two more entries live under this prefix but are declared elsewhere, because
  # their values do not exist until the component that produces them does (FR-031):
  #   db/url               -> the database component (SCRUM-175)
  #   cors/allowed-origins -> whatever creates the web application's public origin
  config_parameters = {
    "db/username"               = var.database_username
    "cognito/issuer-uri"        = local.cognito.issuer_uri
    "cognito/jwk-set-uri"       = local.cognito.jwks_uri
    "cognito/client-ids"        = join(",", [local.cognito.web_client_id, local.cognito.mobile_client_id, local.cognito.cli_client_id])
    "spring/profiles-active"    = "staging"
    "weather/ingestion-enabled" = "true"

    # SCRUM-373 (FR-008) — deliberately a placeholder, not a real manifest.
    # NOT an empty string: AWS SSM PutParameter rejects "" outright
    # ("Member must have length greater than or equal to 1" — found live,
    # secrets-shared-dev apply, 2026-08-15), so "unset" is the closest
    # AWS-API-legal equivalent. The only trained WBGT model artifact that
    # exists today (a SageMaker experiment output) is not approved for
    # inference, so there is nothing to activate in this issue.
    # ForecastModelRegistry.from_environment() (ml-service/crewsafe_ml/
    # inference.py) cannot distinguish "unset" from "a path that doesn't
    # resolve": both raise inside ForecastService.from_environment()'s
    # try/except (OSError from Path("unset").resolve(strict=True)), landing
    # on model_configuration_failed=True — behaviorally identical to the
    # model_registry=None state a true empty value would have produced
    # (forecast() without context still serves the persistence baseline
    # either way; forecast() with context still raises
    # ForecastModelUnavailableError either way). The one observable
    # difference is a single ERROR-level "Configured WBGT model bundle could
    # not be loaded" log line at every task start until a real bundle is
    # promoted — an accepted, documented trade-off, not a bug. Declaring the
    # slot now (rather than adding it only in the follow-up that promotes a
    # model) means that follow-up is a parameter VALUE change, not a
    # task-definition change.
    "ml/model-manifest"        = "unset"
    "ml/model-manifest-sha256" = "unset"
  }

  config_parameter_descriptions = {
    "db/username"               = "PostgreSQL user the backend connects as. Written by Terraform; read by the task execution role at task start. Not a credential - the password is held by the managed database service."
    "cognito/issuer-uri"        = "Cognito issuer the backend validates access tokens against. Sourced from the cognito-shared-dev component; read by the task execution role."
    "cognito/jwk-set-uri"       = "Cognito JWKS endpoint the backend fetches signing keys from. Sourced from the cognito-shared-dev component; read by the task execution role."
    "cognito/client-ids"        = "Comma-separated Cognito client identifiers the backend accepts audiences from. Sourced from the cognito-shared-dev component; read by the task execution role."
    "spring/profiles-active"    = "Spring profile the deployed backend runs under. Written by Terraform; read by the task execution role. Must never be local."
    "weather/ingestion-enabled" = "Whether the backend polls the external weather service on a schedule. Written by Terraform; read by the task execution role. The application defaults this off so a developer machine never calls a live safety-data service."
    "ml/model-manifest"         = "Path to the checksum-verified WBGT model manifest ml-service reads at startup. Placeholder value 'unset' (SSM rejects empty strings): no model bundle is approved_for_inference yet. A future promotion updates this value only - no task-definition change. Never a secret; the manifest path and checksum are not sensitive."
    "ml/model-manifest-sha256"  = "Expected SHA-256 checksum of the manifest named above. Placeholder value 'unset' alongside it, for the same AWS API reason; ForecastModelRegistry.from_environment() requires both or neither to be set meaningfully."
  }
}

# ---------------------------------------------------------------------------
# Secret entries
#
# Exactly one container. Terraform declares its NAME, description, recovery
# window, and tags — never its value. There is deliberately no
# aws_secretsmanager_secret_version resource anywhere in this component: that is
# the mechanism behind FR-005, and the source guard in
# .github/scripts/terraform/tests/test-secrets-source-guard.sh keeps it absent.
#
# The database master credential is NOT declared here. The managed database
# service creates, stores, and rotates it under a name it chooses (FR-029), so no
# Terraform component ever holds that value either.
#
# Encryption uses the store's default AWS-managed key. No customer-managed key is
# created (FR-030), so authorization is expressed solely in the two read policies
# below rather than being split with a key policy the tests do not inspect.
# ---------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "weather_api_key" {
  name        = "${local.secret_name_prefix}/weather-api-key"
  description = "data.gov.sg API key for the NEA real-time weather service. Written out of band by an operator; read at task start by the task execution role. Created empty - the application treats an absent key as optional and falls back to unauthenticated rate limits."

  # FR-007 — an accidental deletion stays recoverable rather than being immediate.
  recovery_window_in_days = var.secret_recovery_window_days

  lifecycle {
    precondition {
      condition     = data.aws_caller_identity.current.account_id == var.expected_account_id
      error_message = "Authenticated AWS account does not match the expected account for this dispatch."
    }
  }
}

# ---------------------------------------------------------------------------
# Configuration entries
#
# Plain String parameters, because none of these is a secret. Encrypting a public
# value would obscure which entries are actually sensitive and make the
# least-privilege boundary harder to review (FR-003).
#
# The database URL is absent: its value does not exist until the database does, so
# the database component declares that entry under this same prefix (FR-031). A
# placeholder with ignore_changes was rejected — it would hold a stale value in
# state and suppress genuine drift on the same field.
# ---------------------------------------------------------------------------

resource "aws_ssm_parameter" "config" {
  for_each = local.config_parameters

  name        = "${local.parameter_path_prefix}/${each.key}"
  type        = "String"
  value       = each.value
  description = local.config_parameter_descriptions[each.key]
}

# ---------------------------------------------------------------------------
# Permission documents
#
# Composed as HCL objects and rendered with jsonencode() rather than built with
# data "aws_iam_policy_document". That choice is what makes User Story 2 testable:
# under mock_provider the data source's `json` attribute is fabricated, so every
# assertion about policy content would be checking invented data and passing
# meaninglessly. A jsonencode() of configuration is pure Terraform computation,
# identical under a mock and against the real provider (research.md R-004).
#
# Every statement carries a Sid so a reviewer can name what they are reading, and
# every Resource is either an exact ARN under this component's scope, a wildcard
# under that scope, or one of the two documented exceptions below.
# ---------------------------------------------------------------------------

locals {
  # Shared by both identities: the credential reads, and nothing else.
  secret_read_statements = [
    {
      Sid      = "ReadComponentSecrets"
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = local.secrets_arn_pattern
    },
    {
      # FR-029 — the one grant in this component reaching outside its own naming
      # scope. The managed database service names this secret (rds!db-<uuid>) and
      # it does not exist until the database does, so it cannot be pinned by ARN.
      # AWS reserves the rds! prefix, so no customer secret can occupy it and the
      # grant cannot be widened by creating a similarly named secret.
      # Narrowable later: the published task_execution_role_name lets the database
      # component attach a precisely pinned grant once the real ARN exists.
      Sid      = "ReadServiceManagedDatabaseCredential"
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = local.rds_managed_secret_arn_pattern
    },
  ]

  task_execution_policy = {
    Version = "2012-10-17"
    Statement = concat(local.secret_read_statements, [
      {
        Sid    = "ReadComponentParameters"
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath",
        ]
        Resource = local.parameters_arn_pattern
      },
      {
        Sid    = "PullContainerImageLayers"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
        ]
        Resource = local.ecr_repository_arn_pattern
      },
      {
        Sid    = "WriteApplicationLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = local.log_group_arn_pattern
      },
      {
        # FR-032 — the ONLY resource wildcard permitted in this component, and the
        # only statement a reviewer must think about twice.
        #
        # ecr:GetAuthorizationToken does not support resource-level permissions:
        # the ECR API accepts nothing but "*" for it, which is why AWS's own
        # AmazonECSTaskExecutionRolePolicy is written the same way. There is no
        # narrower formulation to write.
        #
        # It is held to exactly one action in exactly one statement so it cannot
        # quietly acquire a second, and SC-016 asserts all three of those facts.
        # Attaching the AWS managed policy instead would have granted image and
        # log access across the entire account; writing these statements out by
        # hand is what makes every other one prefix-scoped.
        Sid      = "GetRegistryAuthorizationToken"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
    ])
  }

  # FR-010, FR-015 — the running application's own identity. It reads the two
  # credentials and nothing else: no parameter read, no image pull, no log write.
  # Those belong to the platform starting the task, not to the code inside it, and
  # granting them here would make the separation cosmetic.
  #
  # SCRUM-371 — the one addition since: this identity's own task is what a
  # developer's ECS Exec session runs inside, so the task itself needs the four
  # ssmmessages channel actions to host that session's SSM agent sidecar. These
  # accept no resource-level scoping (AWS's ECS task IAM role documentation is
  # explicit: "Using the aws:SourceArn condition key to specify a specific
  # cluster is not currently supported, you should use the wildcard"), the same
  # class of exception GetRegistryAuthorizationToken above already documents.
  # secrets.tftest.hcl's iam_boundary run block holds this to exactly these four
  # actions in exactly one statement, the same discipline applied there.
  #
  # SCRUM-373 — two more additions, one per model identifier ml-service/backend
  # actually invoke (spec FR-006, contracts/bedrock-invoke-grant.md). Kept as
  # two separate statements rather than one with a list Resource: the existing
  # SC-014 assertions call strcontains() directly on each statement's Resource,
  # which type-errors on a list (research.md R-006) — splitting by model also
  # lets each statement carry its own reviewable Sid, matching the rest of this
  # policy's per-concern style. Never bedrock:*, never a resource wildcard.
  task_policy = {
    Version = "2012-10-17"
    Statement = concat(local.secret_read_statements, [
      {
        Sid    = "HostEcsExecSession"
        Effect = "Allow"
        Action = [
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel",
        ]
        Resource = "*"
      },
      {
        # backend's BedrockProperties.modelId (BEDROCK_MODEL_ID, defaulting to
        # this exact identifier) is sent as a fixed value on every
        # POST /mitigations call - never caller-supplied, since ml-service is
        # reachable only from backend inside the task (spec SEC-001). A single-
        # region foundation-model ARN, confirmed against this repository's own
        # SCRUM-187 spike runbook (docs/runbooks/SCRUM-187-bedrock-spike.md).
        Sid      = "InvokeMitigationSuggestionModel"
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel"]
        Resource = "arn:aws:bedrock:${var.aws_region}::foundation-model/anthropic.claude-3-5-sonnet-20241022-v2:0"
      },
      {
        # ml-service/bedrock_client.py's hardcoded health-check model, invoked
        # by GET /bedrock/access (backend's TestBedrockController/
        # BedrockApiClient). A cross-region system-defined inference profile
        # (the "global." prefix) - the profile ARN below is granted alongside
        # the underlying foundation-model ARN in the next statement.
        Sid      = "InvokeBedrockAccessVerificationProfile"
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel"]
        Resource = "arn:aws:bedrock:${var.aws_region}:${var.expected_account_id}:inference-profile/global.anthropic.claude-haiku-4-5-20251001-v1:0"
      },
      {
        # Confirmed live (2026-08-15, secrets-shared-dev, research.md R-005
        # amendment): AWS authorizes bedrock:InvokeModel through a cross-region
        # inference profile against the underlying REGIONAL FOUNDATION MODEL,
        # not the profile ARN above — a live AccessDeniedException named
        # exactly this ARN even with the profile statement already granted.
        # No account-id segment: foundation models are AWS-owned, not
        # account-scoped, matching InvokeMitigationSuggestionModel's shape.
        # Only the ap-southeast-1 ARN is granted because that is the only
        # region ml-service's AnthropicBedrock client ever calls (aws_region
        # is pinned, not multi-region) — confirmed by the live request itself
        # (POST https://bedrock-runtime.ap-southeast-1.amazonaws.com/...).
        Sid      = "InvokeBedrockAccessVerificationFoundationModel"
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel"]
        Resource = "arn:aws:bedrock:${var.aws_region}::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0"
      },
    ])
  }

  # FR-013 — assumable by the container runtime and by nothing else. No wildcard
  # principal, no external account, no other service.
  #
  # SCRUM-191 — the condition below closes a confused-deputy gap, and its shape is
  # not what this component originally planned for. Read this before tightening it.
  #
  # The deferral this replaces said a "production-grade hardening would add an
  # aws:SourceArn condition pinning this to a specific ECS cluster", once a cluster
  # existed. A cluster now exists. The pin does not, because AWS does not support
  # it. From the ECS task IAM role documentation, verbatim:
  #
  #   "Using the aws:SourceArn condition key to specify a specific cluster is not
  #    currently supported, you should use the wildcard to specify all clusters."
  #
  # https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html
  #
  # So the trailing :* is the documented form, not laziness and not a placeholder.
  # A value naming a cluster would not fail loudly at apply — IAM accepts any
  # syntactically valid trust policy — it would simply never match, denying every
  # assumption and stopping tasks from starting.
  #
  # WHAT THIS CLOSES: a cross-account confused deputy. aws:SourceArn and
  # aws:SourceAccount are populated only when a service acts on behalf of a
  # resource owner, so these two keys stop another account's ECS service principal
  # being induced to assume these roles.
  #
  # WHAT IT DOES NOT CLOSE: a second ECS cluster in THIS account can still assume
  # both roles, and no trust policy can prevent that. Bounded today because the
  # account holds one cluster and Terraform is CI-only. Whoever creates a second
  # cluster must give its tasks their own identities — see the SCRUM-174 runbook.
  #
  # Both operators are strict on purpose. ArnLikeIfExists and StringEqualsIfExists
  # evaluate true when the key is absent, which would remove the risk of denying a
  # legitimate assumption at the cost of making the control unverifiable: a healthy
  # task would prove nothing about whether the condition is enforced. The test suite
  # asserts the ...IfExists forms stay absent.
  ecs_tasks_assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowEcsTasksToAssume"
        Effect    = "Allow"
        Principal = { Service = "ecs-tasks.amazonaws.com" }
        Action    = "sts:AssumeRole"
        Condition = {
          ArnLike      = { "aws:SourceArn" = local.ecs_source_arn_pattern }
          StringEquals = { "aws:SourceAccount" = var.expected_account_id }
        }
      },
    ]
  })
}

# ---------------------------------------------------------------------------
# Identities
#
# Two roles, deliberately separate (FR-010). The execution identity is assumed by
# the container platform to start a task — pull the image, open the log stream,
# resolve secret references into the container's environment. The task identity is
# assumed by the running application itself.
#
# Policies are attached inline rather than as managed policies: an inline policy
# cannot be attached to another principal by accident and is deleted with the
# role, rather than being left orphaned. No aws_iam_role_policy_attachment exists
# anywhere here (FR-014) — the source guard enforces that.
# ---------------------------------------------------------------------------

resource "aws_iam_role" "task_execution" {
  name        = "${local.name_prefix}-task-execution"
  description = "Assumed by the container platform to start a task: pulls the image, opens the log stream, and resolves secret references into the container environment. Reads this component's entries and the service-managed database credential; writes nothing."

  assume_role_policy = local.ecs_tasks_assume_role_policy
}

resource "aws_iam_role" "task" {
  name        = "${local.name_prefix}-task"
  description = "Assumed by the running application. Reads the two credentials it needs and holds no other permission; image-pull and log-write belong to the execution identity."

  assume_role_policy = local.ecs_tasks_assume_role_policy
}

resource "aws_iam_role_policy" "task_execution" {
  name   = "${local.name_prefix}-task-execution-read"
  role   = aws_iam_role.task_execution.id
  policy = jsonencode(local.task_execution_policy)
}

resource "aws_iam_role_policy" "task" {
  name   = "${local.name_prefix}-task-read"
  role   = aws_iam_role.task.id
  policy = jsonencode(local.task_policy)
}
