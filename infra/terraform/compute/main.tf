data "aws_caller_identity" "current" {}

# ---------------------------------------------------------------------------
# Producers
#
# Four remote states, no re-declaration. Every identifier this component needs
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
# public_subnet_ids is deliberately NOT read. The load balancer is internal
# (FR-021), so this component has no use for the public tier.
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

# Read for its CIDR only, so the load balancer's inbound rule has a source. The
# network component publishes no CIDR by design; reading it here changes nothing
# upstream.
data "aws_vpc" "main" {
  id = local.network.vpc_id
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
    DB_URL                    = local.database.db_url_parameter_name
    DB_USERNAME               = "${local.secrets.config_parameter_prefix}/db/username"
    APP_COGNITO_ISSUER_URI    = "${local.secrets.config_parameter_prefix}/cognito/issuer-uri"
    APP_COGNITO_JWK_SET_URI   = "${local.secrets.config_parameter_prefix}/cognito/jwk-set-uri"
    APP_COGNITO_CLIENT_IDS    = "${local.secrets.config_parameter_prefix}/cognito/client-ids"
    SPRING_PROFILES_ACTIVE    = "${local.secrets.config_parameter_prefix}/spring/profiles-active"
    WEATHER_INGESTION_ENABLED = "${local.secrets.config_parameter_prefix}/weather/ingestion-enabled"
    CORS_ALLOWED_ORIGINS      = aws_ssm_parameter.cors_allowed_origins.name
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

# ---------------------------------------------------------------------------
# Access control
#
# Both rules on the load balancer's own group, and the ONE rule this component
# writes into an upstream resource, are separate aws_vpc_security_group_*_rule
# resources rather than inline blocks. Mixing the two styles causes rules to be
# perpetually added and removed, and separate resources make rule counts directly
# assertable — the convention network/main.tf established.
# ---------------------------------------------------------------------------

# AWS restricts security group descriptions to a-zA-Z0-9 and . _-:/()#,@[]+=&;{}!$*
# An apostrophe is not in that set and fails at CreateSecurityGroup, not at plan.
# That is what broke SCRUM-173's first apply, 16 resources in.
resource "aws_security_group" "lb" {
  name        = "${local.name_prefix}-lb"
  description = "Internal load balancer fronting the backend. Reached only through the CloudFront VPC origin; forwards to the application runtime and nothing else."
  vpc_id      = local.network.vpc_id

  tags = { Name = "${local.name_prefix}-lb" }
}

# The VPC origin's network interfaces live inside this VPC, and the resource
# exposes no security group of its own to reference — so the source is the VPC's
# own CIDR. That is wider than a group reference would be, and the width is worth
# stating: it admits anything already inside the VPC, which today is the tasks and
# the database and nothing else. It does NOT admit anything from the internet,
# because the load balancer is internal and has no public address (FR-021).
#
# The CIDR is read from the VPC rather than added to the network component's
# outputs. SCRUM-173 deliberately publishes no CIDR — "consumers have no legitimate
# need for them, and a smaller surface stays stable" — and a read here needs no
# change to a Done component (FR-053).
resource "aws_vpc_security_group_ingress_rule" "lb_from_vpc_origin" {
  security_group_id = aws_security_group.lb.id
  description       = "HTTP from the CloudFront VPC origin, whose network interfaces are inside this VPC. The load balancer is internal, so this is the only path in."
  cidr_ipv4         = data.aws_vpc.main.cidr_block
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "lb_to_app" {
  security_group_id            = aws_security_group.lb.id
  description                  = "To the application runtime on its own port only, by security group reference so no address range can widen it."
  referenced_security_group_id = local.network.app_security_group_id
  from_port                    = local.container_port
  to_port                      = local.container_port
  ip_protocol                  = "tcp"
}

# FR-019 — the single rule this component writes into a resource another component
# owns, and the only such write in the whole component.
#
# SCRUM-173 created the application security group with NO inbound rule and said so
# in that resource's own description: "no inbound rule is defined here because load
# balancer ingress belongs to the compute component" (network/main.tf:145). This
# discharges that delegation.
#
# By security group reference, never a CIDR. A CIDR rule would satisfy connectivity
# and quietly widen the boundary — and membership of this group is the ONLY thing
# granting database access, so widening it widens database reachability too.
resource "aws_vpc_security_group_ingress_rule" "app_from_lb" {
  security_group_id            = local.network.app_security_group_id
  description                  = "Application port from the internal load balancer only. Created by the compute component under the delegation SCRUM-173 recorded."
  referenced_security_group_id = aws_security_group.lb.id
  from_port                    = local.container_port
  to_port                      = local.container_port
  ip_protocol                  = "tcp"
}

# ---------------------------------------------------------------------------
# Origin
#
# internal = true is the single most consequential argument in this component.
#
# A publicly trusted certificate cannot be issued for a load-balancer-owned
# *.elb.amazonaws.com name, so the hop from the distribution to its origin cannot
# be secured by TLS. Keeping that hop off the public internet is the substitute,
# and making the origin internal is what turns FR-021 into a structural property
# rather than a rule a later edit could widen.
#
# The rejected alternative — a public load balancer fenced by CloudFront's managed
# prefix list plus a shared origin header — needed a secret in Terraform state,
# which SCRUM-174 and SCRUM-175 forbid categorically. The prefix list alone would
# have admitted any distribution in the fleet, including one created in an
# unrelated account.
# ---------------------------------------------------------------------------

resource "aws_lb" "main" {
  name               = "${local.name_prefix}-backend"
  internal           = true
  load_balancer_type = "application"
  subnets            = local.network.private_subnet_ids
  security_groups    = [aws_security_group.lb.id]

  enable_deletion_protection = true

  # Strip headers that do not conform to RFC 7230 before they reach the task. The
  # distribution forwards viewer headers verbatim under Managed-AllViewerExceptHostHeader,
  # so without this the load balancer is a pass-through for anything a viewer sends.
  # Dropping them here means the application never has to be the first thing that
  # decides a malformed header is malformed.
  drop_invalid_header_fields = true

  tags = { Name = "${local.name_prefix}-backend" }
}

resource "aws_lb_target_group" "backend" {
  name        = "${local.name_prefix}-backend"
  port        = local.container_port
  protocol    = "HTTP"
  vpc_id      = local.network.vpc_id
  target_type = "ip"

  # Shorter than the 300s default. One task, no long-lived requests, so holding a
  # draining target open for five minutes only slows a replacement down.
  deregistration_delay = 30

  # The probe asks the APPLICATION, not the process. /actuator/health is exposed
  # with show-details: never and is permitAll() in SecurityConfig, so it answers
  # without credentials. Spring's default health group includes the datastore,
  # which is what makes REL-002 work: a database the task cannot reach marks the
  # endpoint down, the target deregisters, and the task is replaced — rather than
  # serving errors as though healthy.
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

# One default action, and it forwards. A fixed-response or redirect action would be
# a path to the endpoint that answers without reaching the application, skipping
# every authorization control the application enforces (FR-018).
#
# Plaintext on 80 is correct HERE and is not a public plaintext listener: the load
# balancer is internal and unreachable from the internet. TLS is terminated at the
# distribution, which redirects plaintext viewers (FR-025).
#
# AWS-0054 fires on protocol = "HTTP" without inspecting `internal`. The finding is
# accepted, not worked around: the alternative it asks for is unreachable, because a
# publicly trusted certificate cannot be issued for the *.elb.amazonaws.com name this
# listener answers on — the same constraint that produced internal = true above. If
# this load balancer ever becomes public, this exemption becomes wrong, which is why
# the source guard forbids `internal = false` outright.
#trivy:ignore:AWS-0054
resource "aws_lb_listener" "backend" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend.arn
  }
}

# ---------------------------------------------------------------------------
# Public edge
# ---------------------------------------------------------------------------

resource "aws_cloudfront_vpc_origin" "backend" {
  vpc_origin_endpoint_config {
    name                   = "${local.name_prefix}-backend"
    arn                    = aws_lb.main.arn
    http_port              = 80
    https_port             = 443
    origin_protocol_policy = "http-only"

    origin_ssl_protocols {
      quantity = 1
      items    = ["TLSv1.2"]
    }
  }
}

# AWS-0011 (no web ACL) is accepted for shared-dev. A WAF is a production edge
# control with a per-account monthly cost and a rule set that has to be tuned against
# real traffic; this distribution fronts a single-task development environment whose
# only client is the team. Attaching an untuned managed rule group here would buy a
# passing scan and a source of false blocks, not protection. The controls this
# environment actually depends on are structural and are in this file: the origin is
# unreachable except through the distribution, every route requires a Cognito-issued
# token, and authorization is enforced server-side per object and site.
#trivy:ignore:AWS-0011
resource "aws_cloudfront_distribution" "main" {
  enabled         = true
  comment         = "crewsafe shared-dev backend API. Origin is an internal load balancer with no public address (SCRUM-176)."
  is_ipv6_enabled = true

  origin {
    origin_id   = "backend"
    domain_name = aws_lb.main.dns_name

    vpc_origin_config {
      vpc_origin_id = aws_cloudfront_vpc_origin.backend.id
    }
  }

  default_cache_behavior {
    target_origin_id       = "backend"
    viewer_protocol_policy = "redirect-to-https"

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

  # The default provider certificate, on a provider-issued *.cloudfront.net name.
  # minimum_protocol_version MUST be set explicitly: with the default certificate
  # and no override the distribution accepts TLS 1.0, and SC-003 fails outright.
  viewer_certificate {
    cloudfront_default_certificate = true
    minimum_protocol_version       = "TLSv1.2_2021"
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

  network_configuration {
    subnets          = local.network.private_subnet_ids
    security_groups  = [local.network.app_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.backend.arn
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

  depends_on = [aws_lb_listener.backend]

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
