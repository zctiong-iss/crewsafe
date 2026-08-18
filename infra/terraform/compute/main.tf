data "aws_caller_identity" "current" {}

# ---------------------------------------------------------------------------
# Producers
#
# Five remote states, no re-declaration. Every identifier this component needs
# already has an owner, and reading it here rather than copying it means a change
# upstream cannot leave a stale value behind.
#
# The bucket name is derived, not configured: the convention lives in
# .github/scripts/terraform/resolve-terraform-account.sh:62 and is mirrored here,
# exactly as the secrets and database components do. That is the one duplication
# this component accepts — changing it there without changing it here fails loudly
# at init rather than silently producing wrong values. The plan role already holds
# s3:GetObject on crewsafe/*, so a fourth state read needs no IAM change.
#
# SCRUM-204 completed the origin migration in separately reviewed preparation,
# cutover, and cleanup revisions. The compute component now consumes both private
# task subnets and public load-balancer subnets from the same network state.
# ---------------------------------------------------------------------------

data "terraform_remote_state" "network" {
  backend = "s3"
  config = {
    bucket = "crewsafe-terraform-state-${var.expected_account_id}-${var.aws_region}"
    key    = "crewsafe/network/shared-dev.tfstate"
    region = var.aws_region
  }
}

data "terraform_remote_state" "secrets" {
  backend = "s3"
  config = {
    bucket = "crewsafe-terraform-state-${var.expected_account_id}-${var.aws_region}"
    key    = "crewsafe/secrets/shared-dev.tfstate"
    region = var.aws_region
  }
}

data "terraform_remote_state" "database" {
  backend = "s3"
  config = {
    bucket = "crewsafe-terraform-state-${var.expected_account_id}-${var.aws_region}"
    key    = "crewsafe/database/shared-dev.tfstate"
    region = var.aws_region
  }
}

# SCRUM-177 owns the registry (pull request #40). This component consumes it and
# never declares one — the source guard keeps aws_ecr_* absent (FR-002, SC-027).
data "terraform_remote_state" "ecr" {
  backend = "s3"
  config = {
    bucket = "crewsafe-terraform-state-${var.expected_account_id}-${var.aws_region}"
    key    = "crewsafe/ecr/shared-dev.tfstate"
    region = var.aws_region
  }
}

# SCRUM-371 — read-only. Never written by this component (contracts/
# developer-access-consumer-compliance.md rule 4). The only output consumed is
# developer_group_name, so the new grant below attaches to the group SCRUM-372
# already created rather than a hardcoded name or a second group.
data "terraform_remote_state" "developer_access" {
  backend = "s3"
  config = {
    bucket = "crewsafe-terraform-state-${var.expected_account_id}-${var.aws_region}"
    key    = "crewsafe/developer-access/shared-dev.tfstate"
    region = var.aws_region
  }
}

# ---------------------------------------------------------------------------
# Managed edge policies
#
# Referenced, not authored. An API needs caching off and headers forwarded; AWS
# publishes managed policies for exactly that, so two data sources replace two
# resources a reviewer would otherwise have to check by hand.
#
# CachingDisabled: an API's responses are per-caller. Caching is a correctness bug
# here, not a tuning choice — a cached authenticated response can be served to a
# different caller.
#
# AllViewerExceptHostHeader: forwards every header (including Authorization), every
# cookie, and every query string, while letting the origin see its own host name.
# Plain AllViewer would forward the viewer's Host to the load balancer, which makes
# host-based routing and the origin's health semantics behave unpredictably.
# ---------------------------------------------------------------------------

# AWS maintains this list as the CloudFront edge fleet changes. The public ALB
# admits only these origin-facing addresses;
# manually maintained CIDRs and 0.0.0.0/0 are forbidden by the source guard.
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

locals {
  name_prefix = "crewsafe-shared-dev"

  network  = data.terraform_remote_state.network.outputs
  secrets  = data.terraform_remote_state.secrets.outputs
  database = data.terraform_remote_state.database.outputs
  ecr      = data.terraform_remote_state.ecr.outputs

  # Constrained, not chosen. The execution role's log-write grant covers
  # arn:aws:logs:...:log-group:/crewsafe/shared-dev/* (secrets/main.tf:47). A name
  # outside that scope produces a task that fails to start with an authorization
  # error reading like a permissions bug rather than a naming one.
  log_group_name = "/crewsafe/shared-dev/backend"

  container_name = "backend"
  container_port = 8080

  container_image = "${local.ecr.repository_url}:${var.initial_image_tag}"

  parameter_arn_prefix = "arn:aws:ssm:${var.aws_region}:${var.expected_account_id}:parameter"

  # Every value the deployed application needs, as a reference the platform
  # resolves at task start using the execution role. Nothing is baked into the
  # image and nothing is a plaintext environment value (FR-027).
  #
  # NEA_API_KEY is deliberately ABSENT. SCRUM-174 created that secret container
  # with no version, because an operator writes the value out of band and the
  # application treats an absent key as optional (api-key: ${NEA_API_KEY:}). A
  # reference to a versionless secret does not resolve to an empty string —
  # GetSecretValue returns ResourceNotFoundException, the container start fails,
  # and EVERY deploy breaks while the key is unset, which is today's state. The
  # application's tolerance is a Spring binding behaviour and does not extend to
  # the platform's secret resolution. Adding it later is a task-definition change,
  # not just a secret write (FR-033).
  parameter_secrets = {
    DB_URL                      = local.database.db_url_parameter_name
    DB_USERNAME                 = "${local.secrets.config_parameter_prefix}/db/username"
    APP_COGNITO_ISSUER_URI      = "${local.secrets.config_parameter_prefix}/cognito/issuer-uri"
    APP_COGNITO_JWK_SET_URI     = "${local.secrets.config_parameter_prefix}/cognito/jwk-set-uri"
    APP_COGNITO_CLIENT_IDS      = "${local.secrets.config_parameter_prefix}/cognito/client-ids"
    SPRING_PROFILES_ACTIVE      = "${local.secrets.config_parameter_prefix}/spring/profiles-active"
    WEATHER_INGESTION_ENABLED   = "${local.secrets.config_parameter_prefix}/weather/ingestion-enabled"
    LIGHTNING_INGESTION_ENABLED = "${local.secrets.config_parameter_prefix}/lightning/ingestion-enabled"
    CORS_ALLOWED_ORIGINS        = aws_ssm_parameter.cors_allowed_origins.name
    APP_COGNITO_DEMO_USERS_JSON = aws_ssm_parameter.demo_users_json.name

    # ADR 0018 — CognitoUserProvisioningService's AdminCreateUser target. The IAM
    # grant that actually authorizes the call lives on the task role in
    # infra/terraform/secrets (ProvisionInvitedUserAccounts) — this is only the pool
    # id value, not a credential. CognitoAdminProperties has no separate enabled
    # flag: a blank pool id (before this Terraform applies) is itself the signal
    # that provisioning isn't available yet.
    APP_COGNITO_ADMIN_USER_POOL_ID = "${local.secrets.config_parameter_prefix}/cognito-admin/user-pool-id"
  }

  # The trailing "::" is load-bearing, not cosmetic. The format is
  # <arn>:<json-key>:<version-stage>:<version-id>, and BOTH trailing fields must
  # stay empty: the managed database service rotates this credential on its own
  # schedule, and a pinned reference converts a routine rotation into an outage
  # (FR-028, SCRUM-175 obligation 5). Invisible in a plan diff, so it is asserted.
  database_password_reference = "${local.database.master_user_secret_arn}:password::"

  container_secrets = concat(
    [for name, parameter in local.parameter_secrets : {
      name      = name
      valueFrom = startswith(parameter, "arn:") ? parameter : "${local.parameter_arn_prefix}${parameter}"
    }],
    [{
      name      = "DB_PASSWORD"
      valueFrom = local.database_password_reference
    }],
  )

  # SCRUM-373 — the ml-service sidecar. A same-task, localhost-only container:
  # no portMappings entry here is ever referenced by an aws_lb_target_group,
  # listener, or security-group rule (spec FR-003, SC-004).
  ml_service_container_name  = "ml-service"
  ml_service_container_port  = 8000
  ml_service_container_image = "${local.ecr.ml_service_repository_url}:${var.initial_ml_service_image_tag}"
  ml_service_log_group_name  = "/crewsafe/shared-dev/ml-service"

  # Deliberately its own map, not a merge into local.parameter_secrets above:
  # that map is Spring-Boot-specific (DB_*, Cognito settings) and none of it
  # applies to ml-service. Both entries resolve to the two deliberately-empty
  # SSM parameters secrets/main.tf declares (spec FR-008, research.md R-001) —
  # empty today, not because the reference is wrong, but because no model
  # bundle is approved for inference yet.
  ml_service_parameter_secrets = {
    WBGT_MODEL_MANIFEST        = "${local.secrets.config_parameter_prefix}/ml/model-manifest"
    WBGT_MODEL_MANIFEST_SHA256 = "${local.secrets.config_parameter_prefix}/ml/model-manifest-sha256"
  }

  ml_service_container_secrets = [for name, parameter in local.ml_service_parameter_secrets : {
    name      = name
    valueFrom = "${local.parameter_arn_prefix}${parameter}"
  }]
}

# ---------------------------------------------------------------------------
# Observability
# ---------------------------------------------------------------------------

# The only diagnosis path for a task that fails to start. An image-pull failure, a
# failed migration, a missing required configuration property, and a read-only
# filesystem startup failure all surface here and nowhere else — which is why the
# retention is declared rather than left indefinite, and why it is 14 days rather
# than the database component's 7 (a sprint is two weeks; a seven-day window can
# expire the evidence before the retrospective that needs it).
resource "aws_cloudwatch_log_group" "backend" {
  name              = local.log_group_name
  retention_in_days = var.log_retention_days
}

# SCRUM-373 — its own, dedicated stream. A shared log group would make an
# ml-service failure indistinguishable from a backend one, defeating the
# runbook's own diagnosis path (spec User Story 3, FR-003).
resource "aws_cloudwatch_log_group" "ml_service" {
  name              = local.ml_service_log_group_name
  retention_in_days = var.log_retention_days
}

# ---------------------------------------------------------------------------
# Access control
#
# Both rules on the load balancer's own group, and the one rule this component
# writes into an upstream resource, are separate aws_vpc_security_group_*_rule
# resources rather than inline blocks. Mixing the two styles causes rules to be
# perpetually added and removed, and separate resources make rule counts directly
# assertable — the convention network/main.tf established.
# ---------------------------------------------------------------------------

resource "aws_security_group" "public_lb" {
  name        = "${local.name_prefix}-public-lb"
  description = "Parallel public load balancer for SCRUM-204. Ingress is limited to CloudFronts managed origin-facing prefix list."
  vpc_id      = local.network.vpc_id

  tags = { Name = "${local.name_prefix}-public-lb" }
}

# FR-019 — the application ingress rule below is the one rule this component
# writes into a resource another component owns.
#
# SCRUM-173 created the application security group with NO inbound rule and said so
# in that resource's own description: "no inbound rule is defined here because load
# balancer ingress belongs to the compute component" (network/main.tf:145). This
# discharges that delegation.
#
# The ALB has a public address, but port 80 is
# reachable only from AWS's managed CloudFront origin-facing fleet. That list is
# fleet-wide rather than distribution-specific; the runbook records the trade.
resource "aws_vpc_security_group_ingress_rule" "public_lb_from_cloudfront" {
  security_group_id = aws_security_group.public_lb.id
  description       = "HTTP from CloudFronts managed origin-facing address range only. Fleet-wide; see the SCRUM-204 runbook."
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "public_lb_to_app" {
  security_group_id            = aws_security_group.public_lb.id
  description                  = "To the existing private application runtime on its single container port."
  referenced_security_group_id = local.network.app_security_group_id
  from_port                    = local.container_port
  to_port                      = local.container_port
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "app_from_public_lb" {
  security_group_id            = local.network.app_security_group_id
  description                  = "Application port from the SCRUM-204 parallel public load balancer only."
  referenced_security_group_id = aws_security_group.public_lb.id
  from_port                    = local.container_port
  to_port                      = local.container_port
  ip_protocol                  = "tcp"
}

# ---------------------------------------------------------------------------
# ALB access-log target (SCRUM-443, terraform:S6258)
#
# Private, encrypted, BucketOwnerEnforced — the same hardening pattern the
# web_logs bucket uses (SCRUM-414). Delivery is granted via bucket policy to
# the AWS-managed ELB log-delivery account, not an ACL: ALB access logging has
# required a bucket policy (never an ACL) for this delivery path since ALBs
# were introduced (research.md R-003 in specs/046-terraform-access-logging-
# remediation).
# ---------------------------------------------------------------------------

data "aws_elb_service_account" "main" {}

resource "aws_s3_bucket" "alb_logs" {
  bucket = "${local.name_prefix}-alb-logs"
}

resource "aws_s3_bucket_ownership_controls" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# AWS-managed SSE-S3 (AES256) — access logs are operational metadata (source
# IP, timestamp, request line, status code), the same sensitivity class as
# every other access-log bucket in this stack, so a dedicated KMS key buys no
# confidentiality gain here either (matches the web_logs precedent).
#trivy:ignore:AWS-0132
resource "aws_s3_bucket_server_side_encryption_configuration" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }

    bucket_key_enabled = false
  }
}

resource "aws_s3_bucket_public_access_block" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id

  rule {
    id     = "expire-access-logs"
    status = "Enabled"

    filter {}

    expiration {
      days = var.access_log_expiration_days
    }
  }
}

# jsonencode(), not data "aws_iam_policy_document" — mock_provider "aws"
# fabricates a random opaque string for that data source's .json attribute,
# which defeats plan/apply-mode assertions on the actual statement content
# (same reasoning as local.web_logs_bucket_policy above it in this file).
#
# Two statements, two distinct principals: the ELB log-delivery account
# delivers the ALB's own logs (ALBAccessLogsPolicy), and the S3 log-delivery
# service principal delivers this bucket's own self-logs
# (S3ServerAccessLogsPolicy) — terraform:S6258 flags alb_logs too, since it is
# itself an S3 bucket, mirroring the web_logs self-logging precedent below.
locals {
  alb_logs_bucket_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "ALBAccessLogsPolicy"
        Effect    = "Allow"
        Action    = ["s3:PutObject"]
        Resource  = "${aws_s3_bucket.alb_logs.arn}/AWSLogs/${var.expected_account_id}/*"
        Principal = { AWS = data.aws_elb_service_account.main.arn }
      },
      {
        Sid       = "S3ServerAccessLogsPolicy"
        Effect    = "Allow"
        Action    = ["s3:PutObject"]
        Resource  = "${aws_s3_bucket.alb_logs.arn}/*"
        Principal = { Service = "logging.s3.amazonaws.com" }
        Condition = {
          ArnLike = {
            "aws:SourceArn" = aws_s3_bucket.alb_logs.arn
          }
          StringEquals = {
            "aws:SourceAccount" = var.expected_account_id
          }
        }
      },
    ]
  })
}

resource "aws_s3_bucket_policy" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id
  policy = local.alb_logs_bucket_policy
}

resource "aws_s3_bucket_logging" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id

  target_bucket = aws_s3_bucket.alb_logs.id
  target_prefix = "alb-logs-bucket-access-logs/"
}

# ---------------------------------------------------------------------------
# Origins
#
# SCRUM-204 selects the verified public ALB for CloudFront's existing backend
# origin. The legacy internal path was retained through cutover validation and is
# removed by the separately reviewed cleanup revision.
# ---------------------------------------------------------------------------

# This ALB is intentionally public (AWS-0053), with reachability fenced by the
# managed-prefix-list rule rather than by 0.0.0.0/0.
#trivy:ignore:AWS-0053
resource "aws_lb" "public" {
  name               = "${local.name_prefix}-public"
  internal           = false
  load_balancer_type = "application"
  subnets            = local.network.public_subnet_ids
  security_groups    = [aws_security_group.public_lb.id]

  enable_deletion_protection = true
  drop_invalid_header_fields = true

  access_logs {
    bucket  = aws_s3_bucket.alb_logs.id
    enabled = true
  }

  depends_on = [aws_s3_bucket_policy.alb_logs]

  tags = { Name = "${local.name_prefix}-public" }
}

# The public target group probes the application and registers the existing ECS
# workload; no second runtime is created.
resource "aws_lb_target_group" "public" {
  name        = "${local.name_prefix}-public"
  port        = local.container_port
  protocol    = "HTTP"
  vpc_id      = local.network.vpc_id
  target_type = "ip"

  deregistration_delay = 30

  health_check {
    path                = "/actuator/health"
    port                = "traffic-port"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

# HTTP is the documented temporary origin transport: no trusted certificate can
# be issued for the AWS-owned ALB hostname. Its security group accepts only the
# managed CloudFront prefix list, and all requests still reach backend authn/z.
#
# SonarQube terraform:S5332 (issue AZ_LiOshb-JeFb7z_1Fk) is accepted for this
# same reason — SCRUM-414 formally marks that finding accepted rather than
# open, so the codebase and the scanner's own state agree.
#trivy:ignore:AWS-0054
resource "aws_lb_listener" "public" {
  load_balancer_arn = aws_lb.public.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.public.arn
  }
}

# ---------------------------------------------------------------------------
# Public edge
# ---------------------------------------------------------------------------

# AWS-0011 (no web ACL) is accepted for shared-dev. A WAF is a production edge
# control with a per-account monthly cost and a rule set that has to be tuned against
# real traffic; this distribution fronts a single-task development environment whose
# only client is the team. Attaching an untuned managed rule group here would buy a
# passing scan and a source of false blocks, not protection. The controls this
# environment actually depends on are structural and are in this file: every route
# requires a Cognito-issued token, and authorization is enforced server-side per
# object and site — properties of the application, unaffected by the origin now
# being publicly addressed.
#trivy:ignore:AWS-0011
resource "aws_cloudfront_distribution" "main" {
  enabled         = true
  comment         = "crewsafe shared-dev backend API. CloudFront reaches the prefix-list-fenced public ALB (SCRUM-204 cutover)."
  is_ipv6_enabled = true

  origin {
    origin_id   = "backend"
    domain_name = aws_lb.public.dns_name

    # No trusted certificate can be issued for the AWS-owned ALB hostname. This
    # temporary shared-development hop therefore uses HTTP, with network access
    # limited to AWS's managed CloudFront origin-facing prefix list on port 80.
    # Viewer TLS and backend Cognito authorization remain unchanged.
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id           = "backend"
    viewer_protocol_policy     = "redirect-to-https"
    response_headers_policy_id = aws_cloudfront_response_headers_policy.api_security.id

    # The full set. Omitting the state-changing methods rejects every write
    # endpoint at the edge, before the application sees it.
    allowed_methods = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods  = ["GET", "HEAD"]

    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # SCRUM-443, terraform:S6258. Classic CloudFront logging has no bucket-policy
  # delivery alternative — it requires the log-delivery-write ACL on the target
  # bucket, which is why cloudfront_logs (defined near the web distribution
  # below) is the one bucket in this stack with ACLs enabled.
  logging_config {
    include_cookies = false
    bucket          = aws_s3_bucket.cloudfront_logs.bucket_domain_name
    prefix          = "backend/"
  }

  # TLSv1 is NOT a choice. It is what the default certificate forces, and the comment
  # that used to sit here was wrong.
  #
  # It claimed minimum_protocol_version "MUST be set explicitly" or the distribution
  # accepts TLS 1.0. Setting it changes nothing: with cloudfront_default_certificate the
  # CloudFront API IGNORES this field and pins the security policy to TLSv1. The previous
  # value of "TLSv1.2_2021" therefore produced a diff that could never converge —
  # plan run 30874184699 showed `minimum_protocol_version = "TLSv1" -> "TLSv1.2_2021"`
  # against a distribution that has been applied repeatedly. Every future plan for this
  # component would carry that same phantom change, which is exactly the noise that makes
  # a mandatory plan review stop being read.
  #
  # Declaring the real value kills the phantom diff and makes the posture legible instead
  # of aspirational: THIS EDGE ACCEPTS TLS 1.0.
  #
  # Raising the floor requires a custom certificate on a domain the project controls,
  # because the field is only honoured when cloudfront_default_certificate is false. That
  # is a consequence of choosing the provider-issued *.cloudfront.net hostname, and it was
  # not traced at the time. It needs its own issue — a custom domain, an ACM certificate in
  # us-east-1, and DNS — not a one-line change here.
  viewer_certificate {
    cloudfront_default_certificate = true
    minimum_protocol_version       = "TLSv1"
  }
}

# ---------------------------------------------------------------------------
# Configuration this component owns
#
# The only configuration entry created here (SC-019). It discharges SCRUM-174
# FR-019 and SCRUM-175 obligation 7 — the cross-origin entry both components
# deferred because neither could know the origin.
#
# This component cannot know it either. CORS_ALLOWED_ORIGINS lists CALLER origins,
# and web/ and mobile/ are still empty placeholders; naming this service's own URL
# would permit nothing, because a same-origin request is not subject to
# cross-origin checks. The application's own local development origins keep the
# staging API callable from a developer's browser, and whichever issue deploys the
# web client replaces the value.
# ---------------------------------------------------------------------------

resource "aws_ssm_parameter" "cors_allowed_origins" {
  name        = "${local.secrets.config_parameter_prefix}/cors/allowed-origins"
  type        = "String"
  value       = var.cors_allowed_origins
  description = "Browser origins permitted to call the backend. Read by the task execution role at task start. Not a credential. Replaced by whichever issue deploys the web client."
}

# The second configuration entry, and it exists because the application requires the
# property to be PRESENT rather than merely valid.
#
# DemoDataSeeder is @Profile({"local","staging"}) and this deployment runs the staging
# profile, so it executes. It reads app.cognito.demo-users-json, which carries no
# @NotBlank on CognitoProperties — reading as optional — but a null value throws
# `Mapping JSON is malformed` instead of seeding nothing. The failure therefore lands
# 60 seconds into startup, AFTER Flyway has validated and AFTER the port is bound, so
# it looks like an application defect rather than absent configuration. `[]` is the
# tested no-op value (DemoDataSeederMappingTest asserts it parses to empty).
#
# This component cannot know the real mappings. They come from the shared Cognito
# configuration, which reaches Terraform through no channel — the plan and apply
# workflows pass four TF_VAR_* values and none carries it.
#
# It is created HERE rather than referenced from the secrets component on purpose: a
# `secrets` reference to a parameter that does not exist fails the container start
# outright (FR-033, the reason NEA_API_KEY is still absent). Creating it in the same
# component that references it makes the parameter and its consumer arrive together,
# so there is no window in which the task definition points at nothing.
resource "aws_ssm_parameter" "demo_users_json" {
  name        = "${local.secrets.config_parameter_prefix}/cognito/demo-users-json"
  type        = "String"
  value       = var.demo_users_json
  description = "Reviewed synthetic application-user mappings. Fictional identities only; not a credential. Terraform seeds an empty array and then stops tracking the value — whoever administers the synthetic users owns it."

  # Terraform seeds this once and never again. The real mappings are owned by whoever
  # administers the synthetic users, and without this an apply would silently revert
  # staging's seeded users to the empty default — a data change disguised as a no-op
  # diff. Same reasoning as the service's ignore_changes on task_definition.
  lifecycle {
    ignore_changes = [value]
  }
}

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------

resource "aws_ecs_cluster" "main" {
  name = local.name_prefix

  lifecycle {
    precondition {
      condition     = data.aws_caller_identity.current.account_id == var.expected_account_id
      error_message = "Authenticated AWS account does not match the expected account for this dispatch."
    }
  }
}

resource "aws_ecs_task_definition" "backend" {
  family                   = "${local.name_prefix}-backend"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory

  # Two identities, deliberately separate — the separation SCRUM-174 spent its
  # whole specification establishing. The execution role is assumed by the platform
  # to start a task (pull the image, open the log stream, resolve secret
  # references); the task role is assumed by the running application itself.
  execution_role_arn = local.secrets.task_execution_role_arn
  task_role_arn      = local.secrets.task_role_arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  # NO volume is declared, and that is deliberate — see the note on
  # readonlyRootFilesystem below. A bind mount at /tmp would SHADOW the image's
  # writable /tmp with a root-owned 0755 directory and reintroduce the exact startup
  # failure it looks like it prevents.

  container_definitions = jsonencode([
    {
      name      = local.container_name
      image     = local.container_image
      essential = true

      # Provided by SCRUM-177's image; asserted here because this component owns
      # the task definition that could override it.
      user = "1000"

      portMappings = [
        {
          containerPort = local.container_port
          protocol      = "tcp"
        },
      ]

      # false, and on Fargate this is forced rather than chosen.
      #
      # The application needs writable scratch: the JVM writes /tmp/hsperfdata_<user>
      # at startup and embedded Tomcat allocates a temp directory there. On Fargate
      # there is no way to give a NON-ROOT container writable scratch alongside a
      # read-only root:
      #
      #   - tmpfs is not supported on Fargate at all.
      #   - A bind mount IS supported, but Fargate creates it root-owned at 0755, so
      #     uid 1000 cannot write to it. aws/containers-roadmap#938 is still open;
      #     the Fargate 1.3.0 workaround was removed in 1.4.0.
      #   - Managed EBS volumes do support non-root, but a per-task EBS volume for a
      #     scratch directory costs money and adds attach latency to every cold start.
      #
      # So read-only root and non-root user are mutually exclusive here, and the
      # non-root user is the stronger control — a compromised process confined to an
      # unprivileged uid beats one running as root against a read-only mount it can
      # still subvert through the writable volume it needs. Decided 2026-08-03 after
      # the first task failed with:
      #
      #   WebServerException: Unable to create tempDir. java.io.tmpdir is set to /tmp
      #   Caused by: java.nio.file.AccessDeniedException: /tmp/tomcat.8080.<n>
      #
      # DO NOT "restore hardening" by adding a volume and a mountPoint at /tmp. That
      # is what was here before and it is what caused the failure above. If this
      # control has to come back, it needs a managed EBS volume or a root init
      # container that chowns the mount — both are their own decision, not a tidy-up.
      readonlyRootFilesystem = false

      # Explicitly empty rather than omitted, so the source guard has something to
      # assert against and any future addition is a visible diff. Every value the
      # deployment overrides is a parameter or a secret; none is plaintext here.
      environment = []

      secrets = local.container_secrets

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.backend.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = local.container_name
          "mode"                  = "non-blocking"
          "max-buffer-size"       = "25m"
        }
      }
    },
    {
      # SCRUM-373 — the ml-service sidecar. Fargate awsvpc mode gives every
      # container in a task the same ENI, so backend already reaches this over
      # localhost:8000 (its own FORECAST_BASE_URL/BEDROCK_API_URL defaults) —
      # no service-discovery entry needed. essential = true is the accepted
      # trade-off (spec Known trade-off): a crash-looping ml-service container
      # takes the whole task down with it, the same as any other essential
      # container failure.
      name      = local.ml_service_container_name
      image     = local.ml_service_container_image
      essential = true

      # Provided by ml-service's own Dockerfile (`useradd -m -u 1000 appuser`);
      # asserted here for the same reason backend's is (SCRUM-177's image is
      # authoritative, but this component owns the task definition that could
      # override it).
      user = "1000"

      portMappings = [
        {
          containerPort = local.ml_service_container_port
          protocol      = "tcp"
        },
      ]

      # Unlike backend, no documented JVM-temp-dir blocker exists for this
      # image: its Dockerfile already chmods application files 444 and
      # crewsafe_ml read-only (research.md R-010). Attempted here as the
      # stronger hardening posture; if a real Fargate startup failure surfaces
      # (mirroring backend's own documented incident above), the fix is to set
      # this to false with the same class of justification, not a silent
      # revert.
      readonlyRootFilesystem = true

      # Explicitly empty, matching backend's own convention: every value the
      # deployment overrides is a secret reference, never plaintext.
      environment = []

      secrets = local.ml_service_container_secrets

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ml_service.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = local.ml_service_container_name
          "mode"                  = "non-blocking"
          "max-buffer-size"       = "25m"
        }
      }
    },
  ])
}

resource "aws_ecs_service" "backend" {
  name            = local.container_name
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.backend.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  # SCRUM-371 — hosts the SSM Exec agent sidecar so a developer's session can
  # run inside this task. Fargate's default platform version (unset here,
  # LATEST) already satisfies ECS Exec's >= 1.4.0 minimum; no image or
  # platform-version change is needed (research.md R-006). The task role's own
  # ssmmessages grant (secrets/main.tf, HostEcsExecSession) is what lets the
  # session actually open once this flag is set.
  enable_execute_command = true

  network_configuration {
    subnets          = local.network.private_subnet_ids
    security_groups  = [local.network.app_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.public.arn
    container_name   = local.container_name
    container_port   = local.container_port
  }

  # Must exceed migrations plus application context startup. Flyway runs in-process
  # before the web server accepts connections; if this is too short the platform
  # kills the task mid-migration and retries forever, presenting as a health check
  # failure rather than a timing problem. The default is an ESTIMATE — measure the
  # real cold start on the first apply and adjust (FR-026, SC-026).
  health_check_grace_period_seconds = var.health_check_grace_period_seconds

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [aws_lb_listener.public]

  # -------------------------------------------------------------------------
  # THE DECLARED DIVERGENCE (FR-042, Q4).
  #
  # Terraform owns the infrastructure; CI owns the deployment. The shared plan and
  # apply workflows pass exactly four TF_VAR_* values and offer no per-component
  # input, so the image tag cannot be a dispatch value without changing shared CI
  # that every component inherits. Separating the two concerns is the smaller
  # change and the better boundary: an infrastructure apply needs a reviewed plan
  # and a typed confirmation, which is the right gate for changing a network
  # boundary and the wrong one for shipping a build.
  #
  # SCRUM-145 registers each new task-definition revision and forces a new
  # deployment. The same call, with no new revision, recovers a rotated database
  # credential and a restored database's new address (FR-029, FR-044).
  #
  # CONSEQUENCE, stated because it inverts what every other component here holds:
  # Terraform's recorded task definition is deliberately NOT the running one.
  # `aws ecs describe-services` is authoritative for what is deployed; the state
  # file is not. The runbook says so.
  #
  # Exactly two fields. A third would widen the divergence past what was reviewed.
  # -------------------------------------------------------------------------
  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }
}

# ---------------------------------------------------------------------------
# SCRUM-371 — narrow ECS Exec / RDS-secret grant on the existing developer group
#
# Attaches to crewsafe-developers (SCRUM-372), never a new or second identity
# (contracts/developer-access-consumer-compliance.md rule 1). Exactly three
# actions, each scoped — no restatement of what ViewOnlyAccess (SCRUM-372)
# already grants that group (ecs:Describe*, ecs:List*, rds:DescribeDBInstances
# are deliberately absent here; spec FR-006). See contracts/
# rds-troubleshooting-grant.md for the audit-facing statement of this exact
# policy and research.md R-005 for the ARN-pattern reasoning.
# ---------------------------------------------------------------------------

resource "aws_iam_group_policy" "developers_rds_troubleshooting" {
  name  = "crewsafe-developers-rds-troubleshooting"
  group = data.terraform_remote_state.developer_access.outputs.developer_group_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ExecIntoBackendTask"
        Effect   = "Allow"
        Action   = ["ecs:ExecuteCommand"]
        Resource = "arn:aws:ecs:${var.aws_region}:${var.expected_account_id}:task/${local.name_prefix}/*"
      },
      {
        # Amendment (live-tested 2026-08-14, research.md R-005): ssm:StartSession
        # for the ECS Exec port-forwarding path is authorized against BOTH the
        # ECS task target AND the SSM document resource — confirmed by a live
        # AccessDeniedException naming exactly this document ARN when only the
        # task ARN was granted. AWS-StartPortForwardingSessionToRemoteHost is an
        # AWS-owned public document, hence the account-less "::document/" ARN.
        Sid    = "StartSessionToBackendTask"
        Effect = "Allow"
        Action = ["ssm:StartSession"]
        Resource = [
          "arn:aws:ecs:${var.aws_region}:${var.expected_account_id}:task/${local.name_prefix}/*",
          "arn:aws:ssm:${var.aws_region}::document/AWS-StartPortForwardingSessionToRemoteHost",
        ]
      },
      {
        # Same rds!* wildcard pattern secrets/main.tf's
        # rds_managed_secret_arn_pattern already uses, and for the identical
        # reason: the managed service names this secret and it does not exist
        # as a fixed value until the database does.
        Sid      = "ReadRdsManagedCredentialForTunnel"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = "arn:aws:secretsmanager:${var.aws_region}:${var.expected_account_id}:secret:rds!*"
      },
    ]
  })
}

# ---------------------------------------------------------------------------
# SCRUM-298 — web static hosting runtime and staging origin
#
# S3 + CloudFront, not a container. web/ is a plain client-rendered Vite SPA
# with no server-side runtime need (no environment variable, no session, no
# computation) — confirmed by reading web/package.json and web/vite.config.ts
# directly during /speckit-specify. This section adds NO resource referencing
# aws_lb.public, aws_lb_listener.public, or aws_ecs_cluster.main above: the web
# origin is a second, independent leaf, not a branch grafted onto the backend's
# compute layer (FR-014, spec.md Architecture).
#
# One Cognito state read supplies the browser's issuer and Hosted UI origins — no VPC, subnet,
# secret, database or mutable credential is consumed.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Sync identity
#
# Assumed exclusively by a manually-dispatched GitHub Actions workflow_dispatch
# run on main, via OIDC — never a human's local session (FR-017, Q2). Trust
# policy shape copied from infra/terraform/ecr/main.tf's web push role, the
# same pattern already reviewed and applied for an identical purpose.
# ---------------------------------------------------------------------------

locals {
  web_sync_assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowGitHubActionsMainBranchToAssume"
        Effect = "Allow"
        Principal = {
          Federated = "arn:aws:iam::${var.expected_account_id}:oidc-provider/token.actions.githubusercontent.com"
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
            "token.actions.githubusercontent.com:sub" = var.github_oidc_main_subject
          }
        }
      },
    ]
  })

  # Two statements, least-privilege, scoped to the S3 sync target and verified
  # CloudFront edge (research.md R-006). s3:DeleteObject is present because the sync
  # invocation uses `--delete` (research.md R-007) — without it, every prior
  # build's now-unreferenced hashed assets accumulate in the bucket forever.
  # cloudfront:GetInvalidation is deliberately ABSENT: the workflow issues an
  # invalidation and returns, it does not poll for completion.
  # One statement, both the bucket ARN (ListBucket needs it) and the object
  # prefix (the object-level actions need it) as a Resource list — research.md
  # R-006 specifies exactly two statements total for this policy. The second
  # statement combines invalidation with the narrowly scoped read actions that
  # verify the distribution's attached response-headers policy.
  web_sync_policy = {
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SyncWebBuildToBucket"
        Effect = "Allow"
        Action = [
          "s3:ListBucket",
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
        ]
        Resource = [
          aws_s3_bucket.web.arn,
          "${aws_s3_bucket.web.arn}/*",
        ]
      },
    ]
  }
}

resource "aws_iam_role" "web_sync" {
  name               = "${local.name_prefix}-web-sync"
  assume_role_policy = local.web_sync_assume_role_policy
}

resource "aws_iam_role_policy" "web_sync" {
  name = "${local.name_prefix}-web-sync"
  role = aws_iam_role.web_sync.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      local.web_sync_policy.Statement,
      [
        {
          Sid    = "ManageVerifiedWebDistribution"
          Effect = "Allow"
          Action = [
            "cloudfront:CreateInvalidation",
            "cloudfront:GetDistributionConfig",
            "cloudfront:GetResponseHeadersPolicy",
          ]
          Resource = [
            aws_cloudfront_distribution.web.arn,
            "arn:aws:cloudfront::${var.expected_account_id}:response-headers-policy/${aws_cloudfront_response_headers_policy.web_security.id}",
          ]
        }
      ]
    )
  })
}

# SCRUM-271: release deployment is deliberately separate from Terraform apply.
resource "aws_iam_role" "backend_deploy" {
  name = "${local.name_prefix}-backend-deploy"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = "arn:aws:iam::${var.expected_account_id}:oidc-provider/token.actions.githubusercontent.com" }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = { StringEquals = {
        "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        "token.actions.githubusercontent.com:sub" = var.github_oidc_main_subject
      } }
    }]
  })
}

resource "aws_iam_role_policy" "backend_deploy" {
  name = "${local.name_prefix}-backend-deploy"
  role = aws_iam_role.backend_deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["ecr:DescribeImages"], Resource = "${local.ecr.repository_arn}" },
      { Effect = "Allow", Action = ["ecs:DescribeTaskDefinition", "ecs:RegisterTaskDefinition"], Resource = "*" },
      { Effect = "Allow", Action = ["ecs:DescribeServices", "ecs:UpdateService"], Resource = aws_ecs_service.backend.id },
      { Effect = "Allow", Action = ["iam:PassRole"], Resource = [local.secrets.task_execution_role_arn, local.secrets.task_role_arn], Condition = { StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } } }
    ]
  })
}

# SCRUM-373 follow-up: redeploying an already-published ml-service image must
# not require bumping var.initial_ml_service_image_tag through a Terraform
# apply (research.md R-011's same lesson, applied to the sidecar container).
# A dedicated role, not a reuse of backend_deploy: ECS grants IAM at the
# service level, not per container, so this role's ecs:UpdateService grant is
# scoped to the exact same aws_ecs_service.backend.id backend_deploy already
# holds — reusing that role would add no isolation, only ambiguity about which
# workflow is actually responsible for a given deploy. Matches the precedent
# cognito_mapping_publication already set below for the identical reasoning.
resource "aws_iam_role" "ml_service_deploy" {
  name = "${local.name_prefix}-ml-service-deploy"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = "arn:aws:iam::${var.expected_account_id}:oidc-provider/token.actions.githubusercontent.com" }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = { StringEquals = {
        "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        "token.actions.githubusercontent.com:sub" = var.github_oidc_main_subject
      } }
    }]
  })
}

resource "aws_iam_role_policy" "ml_service_deploy" {
  name = "${local.name_prefix}-ml-service-deploy"
  role = aws_iam_role.ml_service_deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["ecr:DescribeImages"], Resource = "${local.ecr.ml_service_repository_arn}" },
      { Effect = "Allow", Action = ["ecs:DescribeTaskDefinition", "ecs:RegisterTaskDefinition"], Resource = "*" },
      { Effect = "Allow", Action = ["ecs:DescribeServices", "ecs:UpdateService"], Resource = aws_ecs_service.backend.id },
      { Effect = "Allow", Action = ["iam:PassRole"], Resource = [local.secrets.task_execution_role_arn, local.secrets.task_role_arn], Condition = { StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } } }
    ]
  })
}

# SCRUM-303: publishing the application-user mapping changes which signed Cognito
# subjects can enter CrewSafe. It must therefore never share the ordinary backend
# deployment role. This OIDC role can write exactly the one runtime parameter and
# then reuse the already-reviewed immutable-image deployment mechanism.
resource "aws_iam_role" "cognito_mapping_publication" {
  name = "${local.name_prefix}-cognito-mapping-publish"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = "arn:aws:iam::${var.expected_account_id}:oidc-provider/token.actions.githubusercontent.com" }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = { StringEquals = {
        "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        "token.actions.githubusercontent.com:sub" = var.github_oidc_main_subject
      } }
    }]
  })
}

resource "aws_iam_role_policy" "cognito_mapping_publication" {
  name = "${local.name_prefix}-cognito-mapping-publish"
  role = aws_iam_role.cognito_mapping_publication.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # The publication flow never reads this value: it re-derives it from
      # reviewed repository sources and may overwrite only this exact parameter.
      { Effect = "Allow", Action = ["ssm:PutParameter"], Resource = [aws_ssm_parameter.demo_users_json.arn] },
      # The existing deploy script verifies the immutable main image before it
      # registers a replacement task definition and updates this one service.
      { Effect = "Allow", Action = ["ecr:DescribeImages"], Resource = [local.ecr.repository_arn] },
      { Effect = "Allow", Action = ["ecs:DescribeTaskDefinition", "ecs:RegisterTaskDefinition"], Resource = "*" },
      { Effect = "Allow", Action = ["ecs:DescribeServices", "ecs:UpdateService"], Resource = [aws_ecs_service.backend.id] },
      { Effect = "Allow", Action = ["iam:PassRole"], Resource = [local.secrets.task_execution_role_arn, local.secrets.task_role_arn], Condition = { StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } } },
    ]
  })
}

# ---------------------------------------------------------------------------
# Web bucket
#
# Private, versioned, encrypted, ACLs disabled entirely — the same pattern
# infra/terraform/bootstrap/state/main.tf established, plus a noncurrent-version
# lifecycle rule that bucket does not need (research.md R-009): every sync writes
# a full build's worth of new object versions, unlike Terraform state's roughly
# constant key set.
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "web" {
  bucket = "${local.name_prefix}-web"

  # The account-match guard is not repeated here — aws_ecs_cluster.main above
  # already carries it, and one precondition anywhere in the plan is enough to
  # halt the whole apply on a mismatched account. A second copy would only
  # break "rejects_mismatched_account" (compute.tftest.hcl)'s single-resource
  # expect_failures assertion for no additional safety.
}

resource "aws_s3_bucket_versioning" "web" {
  bucket = aws_s3_bucket.web.id
  versioning_configuration {
    status = "Enabled"
  }
}

# AWS-managed SSE-S3 (AES256), matching infra/terraform/bootstrap/state/main.tf's
# own accepted exemption (SCRUM-155) — avoiding a cross-service KMS key,
# rotation, and IAM-grant dependency for this bucket too. The reasoning is
# stronger here than for Terraform state: this bucket's contents are a
# browser-delivered SPA bundle, already fully visible to any client that loads
# the site (spec.md SEC-003). Its privacy exists for integrity and origin
# authenticity — only this distribution can serve it, only a reviewed Terraform
# change can alter it — not confidentiality of the content itself, which a
# customer-managed key would protect but this component has no need to.
#trivy:ignore:AWS-0132
resource "aws_s3_bucket_server_side_encryption_configuration" "web" {
  bucket = aws_s3_bucket.web.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }

    bucket_key_enabled = false
  }
}

resource "aws_s3_bucket_ownership_controls" "web" {
  bucket = aws_s3_bucket.web.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# FR-002. All four flags true — no public ACL, no public policy, no exception.
resource "aws_s3_bucket_public_access_block" "web" {
  bucket = aws_s3_bucket.web.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "web" {
  bucket = aws_s3_bucket.web.id

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"

    noncurrent_version_expiration {
      noncurrent_days = var.web_bucket_noncurrent_version_expiration_days
    }
  }
}

# ---------------------------------------------------------------------------
# Web bucket access-log target (SCRUM-414, terraform:S6258)
#
# Private, encrypted, ACLs disabled entirely — the same hardening pattern the
# web bucket itself uses (research.md R-002). Not versioned: unlike the web
# bucket, access-log objects are write-once and never overwritten in place, so
# there is no noncurrent-version concept for a lifecycle rule to protect
# against; the lifecycle rule below instead bounds total retention directly.
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "web_logs" {
  bucket = "${local.name_prefix}-web-logs"
}

resource "aws_s3_bucket_ownership_controls" "web_logs" {
  bucket = aws_s3_bucket.web_logs.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# AWS-managed SSE-S3 (AES256), matching the web bucket's own accepted
# exemption (research.md R-002) — access logs are operational metadata
# (requester identity, source IP, request metadata), the same sensitivity
# class as the web bucket's own already-public SPA content, so a dedicated
# KMS key buys no confidentiality gain here either.
#trivy:ignore:AWS-0132
resource "aws_s3_bucket_server_side_encryption_configuration" "web_logs" {
  bucket = aws_s3_bucket.web_logs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }

    bucket_key_enabled = false
  }
}

# FR-002. All four flags true — no public ACL, no public policy, no exception.
resource "aws_s3_bucket_public_access_block" "web_logs" {
  bucket = aws_s3_bucket.web_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# FR-004 / research.md R-003. 30 days, matching the CloudWatch retention floor
# this same feature sets for the PostgreSQL engine log group (FR-005).
resource "aws_s3_bucket_lifecycle_configuration" "web_logs" {
  bucket = aws_s3_bucket.web_logs.id

  rule {
    id     = "expire-access-logs"
    status = "Enabled"

    filter {}

    expiration {
      days = var.web_access_log_expiration_days
    }
  }
}

# FR-003. Grants write access to exactly the S3 server-access-logging delivery
# mechanism, scoped to this bucket and to the account and the two buckets that
# deliver logs into it — web (FR-001) and web_logs itself (terraform:S6258
# below) — never a broader principal or resource scope (research.md R-001).
#
# jsonencode(), not data "aws_iam_policy_document" — this file's own header
# comment already records why: mock_provider "aws" fabricates a random string
# for that data source's .json attribute rather than rendering it, which fails
# every test that plans this resource. The web bucket's own CloudFront-read
# policy (below) already learned this the hard way; applying it here from the
# start.
locals {
  web_logs_bucket_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "S3ServerAccessLogsPolicy"
        Effect    = "Allow"
        Action    = ["s3:PutObject"]
        Resource  = "${aws_s3_bucket.web_logs.arn}/*"
        Principal = { Service = "logging.s3.amazonaws.com" }
        Condition = {
          ArnLike = {
            "aws:SourceArn" = [aws_s3_bucket.web.arn, aws_s3_bucket.web_logs.arn]
          }
          StringEquals = {
            "aws:SourceAccount" = var.expected_account_id
          }
        }
      },
    ]
  })
}

resource "aws_s3_bucket_policy" "web_logs" {
  bucket = aws_s3_bucket.web_logs.id
  policy = local.web_logs_bucket_policy
}

# FR-001. Delivers the web bucket's own access logs to the dedicated target
# bucket above — never to itself.
resource "aws_s3_bucket_logging" "web" {
  bucket = aws_s3_bucket.web.id

  target_bucket = aws_s3_bucket.web_logs.id
  target_prefix = "web-access-logs/"
}

# terraform:S6258 flags web_logs too: it is itself an S3 bucket, and an
# unlogged one is exactly the finding this whole feature exists to close.
# Self-logging (source == target) closes the gap without a third bucket —
# a distinct prefix keeps the two object streams apart, and the 30-day
# lifecycle above already bounds total growth regardless of which bucket a
# given log object came from, so this does not create unbounded recursion.
resource "aws_s3_bucket_logging" "web_logs" {
  bucket = aws_s3_bucket.web_logs.id

  target_bucket = aws_s3_bucket.web_logs.id
  target_prefix = "web-logs-bucket-access-logs/"
}

# ---------------------------------------------------------------------------
# CloudFront access-log target (SCRUM-443, terraform:S6258)
#
# Shared by both the backend (main) and web CloudFront distributions,
# distinguished by logging_config.prefix. This is the one deliberate
# exception to this stack's otherwise ACL-free (BucketOwnerEnforced)
# convention: classic CloudFront logging_config requires the target bucket to
# grant the CloudFront log-delivery account via the log-delivery-write canned
# ACL, and AWS has never added a bucket-policy alternative for this specific
# delivery path (research.md R-004 in specs/046-terraform-access-logging-
# remediation). BucketOwnerPreferred is required for the ACL grant below to be
# honoured; every other bucket in this stack keeps BucketOwnerEnforced.
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "cloudfront_logs" {
  bucket = "${local.name_prefix}-cloudfront-logs"
}

resource "aws_s3_bucket_ownership_controls" "cloudfront_logs" {
  bucket = aws_s3_bucket.cloudfront_logs.id
  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

# depends_on is required: AWS rejects an ACL write before ownership controls
# exist in BucketOwnerPreferred mode.
resource "aws_s3_bucket_acl" "cloudfront_logs" {
  bucket = aws_s3_bucket.cloudfront_logs.id
  acl    = "log-delivery-write"

  depends_on = [aws_s3_bucket_ownership_controls.cloudfront_logs]
}

#trivy:ignore:AWS-0132
resource "aws_s3_bucket_server_side_encryption_configuration" "cloudfront_logs" {
  bucket = aws_s3_bucket.cloudfront_logs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }

    bucket_key_enabled = false
  }
}

resource "aws_s3_bucket_public_access_block" "cloudfront_logs" {
  bucket = aws_s3_bucket.cloudfront_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "cloudfront_logs" {
  bucket = aws_s3_bucket.cloudfront_logs.id

  rule {
    id     = "expire-access-logs"
    status = "Enabled"

    filter {}

    expiration {
      days = var.access_log_expiration_days
    }
  }
}

# terraform:S6258 also flags cloudfront_logs itself (it is an S3 bucket, and
# an unlogged one is exactly the finding this whole feature exists to close).
# Self-logging uses the standard S3 bucket-policy delivery mechanism (not the
# ACL above, which is specifically for CloudFront's own delivery) — the two
# mechanisms coexist independently on the same bucket.
locals {
  cloudfront_logs_bucket_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "S3ServerAccessLogsPolicy"
        Effect    = "Allow"
        Action    = ["s3:PutObject"]
        Resource  = "${aws_s3_bucket.cloudfront_logs.arn}/*"
        Principal = { Service = "logging.s3.amazonaws.com" }
        Condition = {
          ArnLike = {
            "aws:SourceArn" = aws_s3_bucket.cloudfront_logs.arn
          }
          StringEquals = {
            "aws:SourceAccount" = var.expected_account_id
          }
        }
      },
    ]
  })
}

resource "aws_s3_bucket_policy" "cloudfront_logs" {
  bucket = aws_s3_bucket.cloudfront_logs.id
  policy = local.cloudfront_logs_bucket_policy
}

resource "aws_s3_bucket_logging" "cloudfront_logs" {
  bucket = aws_s3_bucket.cloudfront_logs.id

  target_bucket = aws_s3_bucket.cloudfront_logs.id
  target_prefix = "cloudfront-logs-bucket-access-logs/"
}

# ---------------------------------------------------------------------------
# Public edge
#
# CloudFront reaches the bucket exclusively through Origin Access Control —
# never a public bucket endpoint, never the legacy Origin Access Identity
# (FR-004). Two managed cache policies, referenced as data sources rather than
# authored, mirroring this component's existing convention for the backend
# distribution (Managed-CachingDisabled is already declared above; reused here,
# not redeclared).
#
# AWS-0011 (no WAF) accepted on the same basis the backend distribution's
# exemption already records: a single shared-dev environment whose only client
# is the team, where an untuned managed rule group would buy a passing scan and
# false blocks, not real protection.
# ---------------------------------------------------------------------------

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${local.name_prefix}-web"
  description                       = "OAC restricting the web bucket to this distribution only."
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

#trivy:ignore:AWS-0011
resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  comment             = "crewsafe shared-dev web static hosting (SCRUM-298). S3 via Origin Access Control only."
  is_ipv6_enabled     = true
  default_root_object = "index.html"

  origin {
    origin_id                = "web"
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  # Hashed JS/CSS/asset bundles are cache-safe by construction: a filename either
  # names the old build's content (never re-requested) or the new build's (a
  # distinct URL). Aggressive caching here is free of staleness risk.
  default_cache_behavior {
    target_origin_id           = "web"
    viewer_protocol_policy     = "redirect-to-https"
    response_headers_policy_id = aws_cloudfront_response_headers_policy.web_security.id

    allowed_methods = ["GET", "HEAD"]
    cached_methods  = ["GET", "HEAD"]

    cache_policy_id = data.aws_cloudfront_cache_policy.caching_optimized.id
  }

  # index.html is the one object every deploy changes, so it must not be
  # treated as long-lived (FR-011). Reuses the SAME managed policy already
  # declared for the backend distribution above — a data source lookup, not a
  # distribution-scoped resource.
  ordered_cache_behavior {
    path_pattern               = "/index.html"
    target_origin_id           = "web"
    viewer_protocol_policy     = "redirect-to-https"
    response_headers_policy_id = aws_cloudfront_response_headers_policy.web_security.id

    allowed_methods = ["GET", "HEAD"]
    cached_methods  = ["GET", "HEAD"]

    cache_policy_id = data.aws_cloudfront_cache_policy.caching_disabled.id
  }

  # Reproduces web/nginx.conf's `try_files $uri /index.html` SPA fallback with
  # no compute at the edge (FR-010). A client-side route with no matching S3
  # object still resolves in the browser.
  custom_error_response {
    error_code         = 403
    response_code      = "200"
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = "200"
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # SCRUM-443, terraform:S6258. Shares the same cloudfront_logs bucket as the
  # backend distribution above, distinguished by prefix (research.md R-004).
  logging_config {
    include_cookies = false
    bucket          = aws_s3_bucket.cloudfront_logs.bucket_domain_name
    prefix          = "web/"
  }

  # TLSv1 is what the default certificate forces, not a choice — the same
  # honest-not-aspirational value the backend distribution already asserts,
  # for the identical reason (FR-013, research.md R-008). Raising the floor
  # needs a custom domain and an ACM certificate in us-east-1; neither exists.
  viewer_certificate {
    cloudfront_default_certificate = true
    minimum_protocol_version       = "TLSv1"
  }
}

# The bucket policy must come after the distribution: it grants read access
# scoped to this exact distribution's ARN, by reference, so a distribution
# replacement cannot leave a stale grant behind (FR-005).
locals {
  # jsonencode(), not data "aws_iam_policy_document" — this file's own header
  # comment already records why: mock_provider "aws" fabricates a random string
  # for that data source's .json attribute rather than rendering it, which
  # fails every test that plans this resource. jsonencode() over literal HCL
  # values is exactly the pattern the secrets component chose for the same
  # reason, and web_sync_assume_role_policy/web_sync_policy above already
  # follow it — this bucket policy was the one place that didn't, and testing
  # caught it immediately.
  web_bucket_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudFrontReadViaOAC"
        Effect    = "Allow"
        Action    = ["s3:GetObject"]
        Resource  = "${aws_s3_bucket.web.arn}/*"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.web.arn
          }
        }
      },
    ]
  })
}

resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = local.web_bucket_policy
}
