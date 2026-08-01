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

  cognito = data.terraform_remote_state.cognito.outputs

  # Seven entries. A value earns one only where the deployed environment must
  # differ from the default the application already carries (FR-001, research.md
  # R-008). The server port, the weather freshness thresholds, the ingestion
  # interval, and the external weather API base URL all keep their application
  # defaults and are deliberately absent.
  config_parameters = {
    "db/username"               = var.database_username
    "cognito/issuer-uri"        = local.cognito.issuer_uri
    "cognito/jwk-set-uri"       = local.cognito.jwks_uri
    "cognito/client-ids"        = join(",", [local.cognito.web_client_id, local.cognito.mobile_client_id, local.cognito.cli_client_id])
    "cors/allowed-origins"      = join(",", var.cors_allowed_origins)
    "spring/profiles-active"    = "staging"
    "weather/ingestion-enabled" = "true"
  }

  config_parameter_descriptions = {
    "db/username"               = "PostgreSQL user the backend connects as. Written by Terraform; read by the task execution role at task start. Not a credential - the password is held by the managed database service."
    "cognito/issuer-uri"        = "Cognito issuer the backend validates access tokens against. Sourced from the cognito-shared-dev component; read by the task execution role."
    "cognito/jwk-set-uri"       = "Cognito JWKS endpoint the backend fetches signing keys from. Sourced from the cognito-shared-dev component; read by the task execution role."
    "cognito/client-ids"        = "Comma-separated Cognito client identifiers the backend accepts audiences from. Sourced from the cognito-shared-dev component; read by the task execution role."
    "cors/allowed-origins"      = "Comma-separated origins the deployed API accepts cross-origin requests from. Written by Terraform from a reviewed variable; read by the task execution role."
    "spring/profiles-active"    = "Spring profile the deployed backend runs under. Written by Terraform; read by the task execution role. Must never be local."
    "weather/ingestion-enabled" = "Whether the backend polls the external weather service on a schedule. Written by Terraform; read by the task execution role. The application defaults this off so a developer machine never calls a live safety-data service."
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
  task_policy = {
    Version   = "2012-10-17"
    Statement = local.secret_read_statements
  }

  # FR-013 — assumable by the container runtime and by nothing else. No wildcard
  # principal, no external account, no other service.
  #
  # A production-grade hardening would add an aws:SourceArn condition pinning this
  # to a specific ECS cluster. That cluster does not exist yet — the compute
  # component creates it — and writing a placeholder would repeat the mistake
  # FR-031 exists to prevent. Recorded as a follow-up for the compute component.
  ecs_tasks_assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowEcsTasksToAssume"
        Effect    = "Allow"
        Principal = { Service = "ecs-tasks.amazonaws.com" }
        Action    = "sts:AssumeRole"
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
