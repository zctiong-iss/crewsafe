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
# The recovery stage intentionally reads only the private subnet ids. Apply run
# 30880087606 proved the old and new origins cannot be migrated in one graph: it
# removed the listener and rules, then CloudFront rejected deletion of the VPC
# origin it still referenced. The public path must be introduced separately.
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

# The surviving VPC origin reaches the internal load balancer from interfaces
# inside this VPC. The network component deliberately does not publish the CIDR,
# so this component reads it without taking ownership of the VPC.
data "aws_vpc" "main" {
  id = local.network.vpc_id
}

# SCRUM-204 preparation: AWS maintains this list as the CloudFront edge fleet
# changes. The parallel public ALB admits only these origin-facing addresses;
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
    CORS_ALLOWED_ORIGINS        = aws_ssm_parameter.cors_allowed_origins.name
    APP_COGNITO_DEMO_USERS_JSON = aws_ssm_parameter.demo_users_json.name
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

# Distinct from aws_security_group.lb so the recovered and parallel paths can
# coexist. Its only ingress and egress are declared as separate rules below.
resource "aws_security_group" "public_lb" {
  name        = "${local.name_prefix}-public-lb"
  description = "Parallel public load balancer for SCRUM-204. Ingress is limited to CloudFronts managed origin-facing prefix list."
  vpc_id      = local.network.vpc_id

  tags = { Name = "${local.name_prefix}-public-lb" }
}

# --------------------------------------------------------------------------
# RECOVERY STAGE AFTER THE ONE-STEP PUBLIC-ALB MIGRATION PARTIALLY APPLIED.
#
# The discussion below records why the public design was attempted. It is not the
# active topology in this recovery commit. Apply run 30880087606 destroyed the old
# listener and rules, deleted one unused VPC origin, and then failed because the
# distribution still used the other origin. This stage preserves that surviving
# origin and its internal load balancer while restoring the deleted connectivity.
#
# The internal-load-balancer-plus-VPC-origin design was built and applied twice
# (run 30875158574 rebuilt the origin under a new id). Both origins reported
# Deployed and routed nothing: the distribution returned 504 on every request for
# a full day while the load balancer's RequestCount stayed at 0.0. Every
# configurable element was verified correct — listener, security groups in both
# directions, target health, distribution config, origin config — and AWS's own
# VPC Reachability Analyzer confirmed the network path was reachable. The fault
# was never found; it sat somewhere inside CloudFront's VPC-origin machinery,
# undiagnosable from Terraform and not fixed by rebuilding it.
#
# The root cause of NEEDING a VPC origin at all: the project owns no domain name.
# A publicly trusted certificate cannot be issued for either a load-balancer-owned
# *.elb.amazonaws.com name or a bare IP, so a public load balancer could not serve
# HTTPS on its own — hence keeping it off the public internet and reaching it
# through CloudFront's private path instead. That constraint is real. What was
# avoidable was solving it with a mechanism that then could not be debugged.
#
# The attempted trade was the specification's "rejected alternative":
# a public load balancer fenced by CloudFront's managed prefix list. It was
# rejected initially because the header-based variant of it needs a shared secret
# in Terraform state, which SCRUM-174 and SCRUM-175 forbid categorically. THE
# PREFIX LIST ALONE NEEDS NO SECRET. A later migration may use that design, but it
# must introduce a parallel origin before removing this recovery topology.
#
# WHAT THE DEFERRED PUBLIC DESIGN CONCEDES: the CloudFront-to-origin hop crosses the public internet
# in plaintext (origin_protocol_policy below is still http-only — no certificate
# exists for the load balancer's name to make it anything else). Restricting
# ingress to CloudFront's published address range is a defense against
# opportunistic scanning, not a cryptographic guarantee: a request forged with a
# source IP inside that range, or SENT VIA ANY OTHER CLOUDFRONT DISTRIBUTION IN
# ANY AWS ACCOUNT, reaches the load balancer. The prefix list has no concept of
# "this account's distribution" — it is every CloudFront edge location, fleet-wide.
# The controls this environment actually depends on given that are the ones
# already in this file and unaffected by this change: every route requires a
# Cognito-issued token (FR-018's fixed-response guard still applies), and
# authorization is enforced server side per object and site. A caller that reaches
# the application without going through this distribution still cannot act
# without a valid token.
#
# Revisit the deferred design the moment the project acquires a domain name: a public load
# balancer with its OWN ACM certificate removes the need for CloudFront entirely,
# closes the plaintext hop, and removes the fleet-wide reachability concession in
# one change. That is a smaller architecture than what is here, not a bigger one —
# it is the version this component would have shipped with a domain from the
# start.
# --------------------------------------------------------------------------

resource "aws_vpc_security_group_ingress_rule" "lb_from_vpc_origin" {
  security_group_id = aws_security_group.lb.id
  description       = "HTTP from the surviving CloudFront VPC origin, whose network interfaces are inside this VPC."
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

# SCRUM-204 preparation boundary. The ALB has a public address, but port 80 is
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

# A second explicit ALB identity may enter the application group during
# preparation. app_from_lb remains unchanged for the active recovery path.
resource "aws_vpc_security_group_ingress_rule" "app_from_public_lb" {
  security_group_id            = local.network.app_security_group_id
  description                  = "Application port from the SCRUM-204 parallel public load balancer only."
  referenced_security_group_id = aws_security_group.public_lb.id
  from_port                    = local.container_port
  to_port                      = local.container_port
  ip_protocol                  = "tcp"
}

# ---------------------------------------------------------------------------
# Origin
#
# Recovery stage: preserve the existing internal load balancer. Changing
# `internal` or its subnets forces replacement, which cannot happen while the
# surviving VPC origin remains associated with the distribution.
# ---------------------------------------------------------------------------

# The public-load-balancer AWS-0053 exception is deliberately absent in recovery:
# this resource must remain internal and the source guard rejects `internal = false`.
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

# SCRUM-204 preparation uses a new identity rather than changing aws_lb.main.
# Changing the existing ALB's `internal` or subnet set would force replacement
# while its surviving VPC origin is still referenced, repeating run 30880087606.
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

  tags = { Name = "${local.name_prefix}-public" }
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

# Separate readiness evidence for the parallel path. It probes the same
# application and registers the same ECS workload; no second runtime is created.
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

# One default action, and it forwards. A fixed-response or redirect action would be
# a path to the endpoint that answers without reaching the application, skipping
# every authorization control the application enforces (FR-018).
#
# Plaintext on 80 remains inside the VPC in this recovery stage. TLS terminates at
# CloudFront and the internal load balancer has no public address.
#
# AWS-0054 fires on protocol = "HTTP". The finding is accepted, not worked around:
# no publicly trusted certificate can be issued for the *.elb.amazonaws.com name
# this listener answers on, so an HTTPS listener here would need a self-signed or
# private-CA certificate that CloudFront's origin connection would then have to be
# told to trust — more moving parts protecting a hop CloudFront does not verify
# either way (origin_protocol_policy is http-only below, by the same constraint).
# The distribution redirects viewers to TLS, and every application route still
# requires a Cognito-issued token regardless of transport.
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

# HTTP is the documented temporary origin transport: no trusted certificate can
# be issued for the AWS-owned ALB hostname. Its security group accepts only the
# managed CloudFront prefix list, and all requests still reach backend authn/z.
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

# Apply attempt 30880087606 deleted the unused original VPC origin but could not
# delete this one because the distribution still references it. Keeping exactly
# this surviving resource in configuration prevents Terraform from racing its
# deletion against the distribution update again. A later migration must first
# establish and verify a parallel public origin, then remove this block in a
# separate reviewed apply.
resource "aws_cloudfront_vpc_origin" "rebuilt" {
  vpc_origin_endpoint_config {
    name                   = "${local.name_prefix}-vpc-origin"
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
#
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
  comment         = "crewsafe shared-dev backend API. Origin is an internal load balancer with no public address (SCRUM-176)."
  is_ipv6_enabled = true

  origin {
    origin_id   = "backend"
    domain_name = aws_lb.main.dns_name

    vpc_origin_config {
      vpc_origin_id = aws_cloudfront_vpc_origin.rebuilt.id
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

  # SCRUM-204 preparation dual-registers the existing private workload. The
  # legacy attachment above remains until the separately reviewed cleanup.
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

  depends_on = [aws_lb_listener.backend, aws_lb_listener.public]

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
