# Infrastructure tests for the crewsafe shared-dev compute component (SCRUM-176).
#
# Every run block plans against a mocked provider, so no AWS account, credential,
# or network call is involved.
#
# Four groups of assertions are load-bearing rather than routine:
#
#   1. "placement" — tasks must sit in the private subnets, carry no public
#      address, and be attached to the network component's application security
#      group and nothing else. Membership of that group is the ONLY thing granting
#      database access; a task placed elsewhere fails with a connection timeout
#      rather than an authorization error, which is far harder to diagnose.
#   2. "boundary" — the load balancer must be internal, and the single inbound rule
#      this component writes into the network component's group must reference that
#      group by id. A CIDR-based rule would satisfy connectivity and quietly widen
#      the boundary that SCRUM-173 deliberately left for this component to close.
#   3. "credentials" — every credential appears under the container definition's
#      secrets list and never its environment list, with no version pinned. A
#      pinned reference turns the managed service's own credential rotation into an
#      outage.
#   4. "hardening" — non-root, read-only root filesystem, AND a writable /tmp, all
#      three together. The failure mode is having two of them: a read-only root
#      without the mount kills the JVM during startup, before the first application
#      log line, so the symptom is an opaque exit rather than a diagnosable error.
#
# The "derivation" assertions in the outputs group work by pinning sentinel values
# through override_resource. A literal implementation would not track the override;
# a derived one does. That is what makes them meaningful rather than tautological —
# the same reasoning the secrets component used when it chose jsonencode() over
# data "aws_iam_policy_document", whose json attribute a mock fabricates.

# The provider validates several attributes as ARNs before any assertion runs, and
# a mock fabricates short random strings for computed values. These defaults give
# them a realistic shape so the tests exercise the configuration rather than the
# mock's random generator.
mock_provider "aws" {
  mock_resource "aws_lb" {
    defaults = {
      arn      = "arn:aws:elasticloadbalancing:ap-southeast-1:123456789012:loadbalancer/app/crewsafe-shared-dev-backend/0123456789abcdef"
      dns_name = "internal-crewsafe-shared-dev-backend-000000000.ap-southeast-1.elb.amazonaws.com"
    }
  }

  mock_resource "aws_lb_target_group" {
    defaults = {
      arn = "arn:aws:elasticloadbalancing:ap-southeast-1:123456789012:targetgroup/crewsafe-shared-dev-backend/0123456789abcdef"
    }
  }

  mock_resource "aws_ecs_cluster" {
    defaults = {
      arn = "arn:aws:ecs:ap-southeast-1:123456789012:cluster/crewsafe-shared-dev"
      id  = "arn:aws:ecs:ap-southeast-1:123456789012:cluster/crewsafe-shared-dev"
    }
  }

  mock_resource "aws_ecs_task_definition" {
    defaults = {
      arn = "arn:aws:ecs:ap-southeast-1:123456789012:task-definition/crewsafe-shared-dev-backend:1"
    }
  }

  # domain_name is deliberately NOT defaulted here. The derivation run overrides it
  # with a sentinel, and a provider-level default would shadow that override and
  # make the check pass against the mock's value instead of proving anything.
  mock_resource "aws_cloudfront_distribution" {
    defaults = {
      arn = "arn:aws:cloudfront::123456789012:distribution/E1TESTDISTRIB"
    }
  }
}

# The mocked provider fabricates a random account id, which would trip the account
# precondition in every run. Pin it once here so each run exercises what it is
# actually about; "rejects_mismatched_account" varies expected_account_id against
# this fixed identity to prove the precondition still bites.
override_data {
  target = data.aws_caller_identity.current
  values = { account_id = "123456789012" }
}

# terraform_remote_state belongs to the built-in terraform provider, NOT the aws
# provider, so mock_provider "aws" does not cover it. Without these overrides the
# tests attempt a real S3 read and fail offline.
override_data {
  target = data.terraform_remote_state.network
  values = {
    outputs = {
      vpc_id                = "vpc-0test00000000000"
      private_subnet_ids    = ["subnet-0private000000a", "subnet-0private000000b"]
      app_security_group_id = "sg-0app00000000000000"
    }
  }
}

override_data {
  target = data.terraform_remote_state.secrets
  values = {
    outputs = {
      task_execution_role_arn  = "arn:aws:iam::123456789012:role/crewsafe-shared-dev-task-execution"
      task_role_arn            = "arn:aws:iam::123456789012:role/crewsafe-shared-dev-task"
      task_execution_role_name = "crewsafe-shared-dev-task-execution"
      config_parameter_prefix  = "/crewsafe/shared-dev"
    }
  }
}

override_data {
  target = data.terraform_remote_state.database
  values = {
    outputs = {
      master_user_secret_arn = "arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:rds!db-0000-1111-2222"
      db_url_parameter_name  = "/crewsafe/shared-dev/db/url"
    }
  }
}

override_data {
  target = data.terraform_remote_state.ecr
  values = {
    outputs = {
      repository_url = "123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/crewsafe/backend"
      repository_arn = "arn:aws:ecr:ap-southeast-1:123456789012:repository/crewsafe/backend"
    }
  }
}

# The mock fabricates a random string for cidr_block, which fails the provider's
# CIDR validation before any assertion runs. Pin a realistic value matching the
# network component's 10.0.0.0/16.
override_data {
  target = data.aws_vpc.main
  values = { cidr_block = "10.0.0.0/16" }
}

# The two managed policies are AWS-published; the mock fabricates their ids, which
# is fine — the assertions check that the managed policies are REFERENCED, not what
# their ids are.
override_data {
  target = data.aws_cloudfront_cache_policy.caching_disabled
  values = { id = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" }
}

override_data {
  target = data.aws_cloudfront_origin_request_policy.all_viewer_except_host
  values = { id = "b689b0a8-53d0-40ab-baf2-68738e2966ac" }
}

variables {
  expected_account_id = "123456789012"
  account_alias       = "crewsafe-dev"
  initial_image_tag   = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"
}

# ---------------------------------------------------------------------------
# Input validation (FR-049, SC-014)
# ---------------------------------------------------------------------------

run "rejects_mismatched_account" {
  command = plan

  variables {
    expected_account_id = "999999999999"
  }

  expect_failures = [aws_ecs_cluster.main]
}

run "rejects_latest_image_tag" {
  command = plan

  variables {
    initial_image_tag = "latest"
  }

  expect_failures = [var.initial_image_tag]
}

run "rejects_empty_image_tag" {
  command = plan

  variables {
    initial_image_tag = ""
  }

  expect_failures = [var.initial_image_tag]
}

run "rejects_branch_name_as_image_tag" {
  command = plan

  variables {
    initial_image_tag = "main"
  }

  expect_failures = [var.initial_image_tag]
}

run "rejects_wildcard_cors_origin" {
  command = plan

  variables {
    cors_allowed_origins = "*"
  }

  expect_failures = [var.cors_allowed_origins]
}

# ---------------------------------------------------------------------------
# US1 — placement, boundary, and the public edge
# ---------------------------------------------------------------------------

run "placement" {
  command = apply

  assert {
    condition = tolist(aws_ecs_service.backend.network_configuration[0].subnets) == tolist([
      "subnet-0private000000a", "subnet-0private000000b"
    ])
    error_message = "Tasks must be placed in the network component's private subnets and no others (FR-015)."
  }

  assert {
    condition     = aws_ecs_service.backend.network_configuration[0].assign_public_ip == false
    error_message = "Tasks must not be assigned a public address (FR-017)."
  }

  # Exactly one, and it must be upstream's. Membership of that group is the only
  # thing granting database access, so a substitute group here would produce a
  # task that times out against the database rather than failing visibly.
  assert {
    condition = tolist(aws_ecs_service.backend.network_configuration[0].security_groups) == tolist([
      "sg-0app00000000000000"
    ])
    error_message = "Tasks must be attached to exactly the network component's application security group (FR-016)."
  }
}

run "boundary" {
  command = apply

  assert {
    condition     = aws_lb.main.internal == true
    error_message = "The load balancer must be internal — the origin must have no public address (FR-021)."
  }

  assert {
    condition = tolist(aws_lb.main.subnets) == tolist([
      "subnet-0private000000a", "subnet-0private000000b"
    ])
    error_message = "The internal load balancer belongs in the private subnets (FR-021)."
  }

  # The one rule this component writes into an upstream resource. SCRUM-173 left
  # the application security group with no inbound rule and said so in the
  # resource's own description: load balancer ingress belongs here.
  assert {
    condition     = aws_vpc_security_group_ingress_rule.app_from_lb.security_group_id == "sg-0app00000000000000"
    error_message = "The single inbound rule must target the network component's application security group (FR-019)."
  }

  assert {
    condition     = aws_vpc_security_group_ingress_rule.app_from_lb.referenced_security_group_id == aws_security_group.lb.id
    error_message = "Inbound must be admitted by security group reference, never a CIDR — a CIDR rule connects and quietly widens the boundary (FR-019, SC-007)."
  }

  assert {
    condition     = aws_vpc_security_group_ingress_rule.app_from_lb.cidr_ipv4 == null
    error_message = "No CIDR may admit the application port (SC-007)."
  }

  assert {
    condition     = aws_vpc_security_group_ingress_rule.app_from_lb.from_port == 8080 && aws_vpc_security_group_ingress_rule.app_from_lb.to_port == 8080
    error_message = "Only the application port may be admitted (FR-019)."
  }
}

run "public_edge" {
  command = apply

  assert {
    condition     = aws_cloudfront_distribution.main.default_cache_behavior[0].viewer_protocol_policy == "redirect-to-https"
    error_message = "Plaintext must redirect, never be served (FR-025, SC-002)."
  }

  assert {
    condition     = aws_cloudfront_distribution.main.viewer_certificate[0].minimum_protocol_version == "TLSv1.2_2021"
    error_message = "TLS 1.2 minimum must be set EXPLICITLY — the default certificate otherwise implies TLS 1.0 and SC-003 fails (FR-026)."
  }

  # An API's responses are per-caller. With caching enabled, one user's
  # authenticated response can be served to another, or no request reaches the
  # application at all.
  assert {
    condition     = aws_cloudfront_distribution.main.default_cache_behavior[0].cache_policy_id == data.aws_cloudfront_cache_policy.caching_disabled.id
    error_message = "The distribution must not cache application responses (FR-023)."
  }

  assert {
    condition     = aws_cloudfront_distribution.main.default_cache_behavior[0].origin_request_policy_id == data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    error_message = "The Authorization header must be forwarded to the origin intact (FR-023, SC-004)."
  }

  assert {
    condition = alltrue([
      for method in ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"] :
      contains(aws_cloudfront_distribution.main.default_cache_behavior[0].allowed_methods, method)
    ])
    error_message = "State-changing methods must be allowed or every write endpoint is rejected at the edge (FR-023)."
  }

  assert {
    condition     = tolist(aws_cloudfront_distribution.main.default_cache_behavior[0].cached_methods) == tolist(["GET", "HEAD"])
    error_message = "Only safe methods may be cacheable (FR-023)."
  }
}

# SC-013, FR-003. Nothing downstream of SCRUM-177 checks this. If that component
# renames its repository outside the crewsafe/* scope, the secrets component's pull
# grant stops covering it and the task fails to start with an authorization error
# that reads like a permissions bug rather than a naming one.
run "consumed_image_contract" {
  command = apply

  assert {
    condition     = can(regex("^arn:aws:ecr:[a-z0-9-]+:[0-9]{12}:repository/crewsafe/", data.terraform_remote_state.ecr.outputs.repository_arn))
    error_message = "The image repository must fall under the crewsafe/* scope the secrets component's pull grant covers (FR-003, SC-013)."
  }

  assert {
    condition     = jsondecode(aws_ecs_task_definition.backend.container_definitions)[0].image == "123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/crewsafe/backend:a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"
    error_message = "The image reference must be the consumed repository URL joined with the commit-SHA tag (FR-001, FR-004)."
  }
}

# ---------------------------------------------------------------------------
# US2 — credentials and container hardening
# ---------------------------------------------------------------------------

run "credentials_by_reference" {
  command = apply

  # The environment list is plaintext to anyone who can describe the task
  # definition. Every credential belongs in `secrets`, which the platform resolves
  # at task start using the execution role.
  assert {
    condition = length([
      for entry in jsondecode(aws_ecs_task_definition.backend.container_definitions)[0].environment :
      entry if can(regex("(?i)(password|secret|token|credential)", entry.name))
    ]) == 0
    error_message = "No credential may appear as a plaintext environment value (FR-027, SC-008)."
  }

  assert {
    condition = length([
      for entry in jsondecode(aws_ecs_task_definition.backend.container_definitions)[0].secrets : entry if entry.name == "DB_PASSWORD"
    ]) == 1
    error_message = "The database credential must be injected as a secret reference (FR-027)."
  }

  # A correct reference ends with the JSON key and two EMPTY fields. The managed
  # service rotates on its own schedule; a pinned version makes that rotation an
  # outage.
  assert {
    condition = length([
      for entry in jsondecode(aws_ecs_task_definition.backend.container_definitions)[0].secrets :
      entry if !can(regex("::$", entry.valueFrom)) && can(regex("^arn:aws:secretsmanager:", entry.valueFrom))
    ]) == 0
    error_message = "No secret reference may pin a version id or stage (FR-028, SC-009)."
  }

  # SCRUM-174 created the weather key container with NO version, deliberately,
  # because the application treats an absent key as optional. A reference to a
  # versionless secret does not resolve to an empty string — it fails, and the task
  # never starts. Its absence is the requirement.
  assert {
    condition = length([
      for entry in concat(jsondecode(aws_ecs_task_definition.backend.container_definitions)[0].environment, jsondecode(aws_ecs_task_definition.backend.container_definitions)[0].secrets) :
      entry if entry.name == "NEA_API_KEY"
    ]) == 0
    error_message = "NEA_API_KEY must be absent: the secret has no version, and referencing a versionless secret fails the task start (FR-033)."
  }

  # The application owns its schema transition in-process. An override here makes a
  # schema divergence invisible instead of failing fast at startup.
  assert {
    condition = length([
      for entry in concat(jsondecode(aws_ecs_task_definition.backend.container_definitions)[0].environment, jsondecode(aws_ecs_task_definition.backend.container_definitions)[0].secrets) :
      entry if can(regex("SPRING_FLYWAY|SPRING_JPA_HIBERNATE|DDL_AUTO|FLYWAY_", entry.name))
    ]) == 0
    error_message = "No migration or schema-validation override may be set (FR-035, FR-036, SC-020)."
  }
}

run "container_hardening" {
  command = apply

  # All three together, because the failure mode is having two of them.
  assert {
    condition     = jsondecode(aws_ecs_task_definition.backend.container_definitions)[0].user == "1000"
    error_message = "The container must run as a non-root user (FR-014, SC-015)."
  }

  assert {
    condition     = jsondecode(aws_ecs_task_definition.backend.container_definitions)[0].readonlyRootFilesystem == true
    error_message = "The container must run with a read-only root filesystem (FR-013, SC-015)."
  }

  assert {
    condition = length([
      for mount in jsondecode(aws_ecs_task_definition.backend.container_definitions)[0].mountPoints : mount if mount.containerPath == "/tmp"
    ]) == 1
    error_message = "A read-only root filesystem WITHOUT writable scratch at /tmp fails startup before the first log line — the JVM writes hsperfdata and Tomcat allocates a temp directory there (FR-013, SC-015)."
  }

  assert {
    condition     = length(jsondecode(aws_ecs_task_definition.backend.container_definitions)) == 1
    error_message = "Exactly one container. A sidecar is the usual shape of an out-of-band migration step (FR-011, FR-037)."
  }

  assert {
    condition     = length([for c in jsondecode(aws_ecs_task_definition.backend.container_definitions) : c if can(c.command)]) == 0
    error_message = "No command override — the image starts the application, and an override is how a migration gets run separately from the process serving traffic (FR-037)."
  }
}

# ---------------------------------------------------------------------------
# US3 — health drives traffic
# ---------------------------------------------------------------------------

run "health_drives_traffic" {
  command = apply

  assert {
    condition     = aws_lb_target_group.backend.health_check[0].path == "/actuator/health"
    error_message = "The probe must ask the application, not the root path or a synthetic port check (FR-026, SC-016)."
  }

  assert {
    condition     = aws_lb_target_group.backend.health_check[0].matcher == "200"
    error_message = "Actuator returns 503 when down; only 200 may count as healthy (SC-016)."
  }

  assert {
    condition     = aws_lb_target_group.backend.health_check[0].port == "traffic-port"
    error_message = "The probe must reach the container's own port (SC-016)."
  }

  assert {
    condition     = aws_ecs_service.backend.deployment_circuit_breaker[0].enable && aws_ecs_service.backend.deployment_circuit_breaker[0].rollback
    error_message = "A deployment whose tasks never become healthy must roll back rather than drain the service to zero (FR-043, SC-017)."
  }

  # Wired from the variable rather than a literal, so the measured cold start can
  # be applied without editing a resource body.
  assert {
    condition     = aws_ecs_service.backend.health_check_grace_period_seconds == var.health_check_grace_period_seconds
    error_message = "The grace period must come from the variable so the measured value can replace the estimate (FR-026)."
  }

  # A rule that answers on the application path never reaches the application, so
  # every authorization control the application enforces is skipped.
  assert {
    condition     = aws_lb_listener.backend.default_action[0].type == "forward"
    error_message = "The listener must forward. A fixed-response or redirect action is a path to the endpoint that bypasses the application (FR-018, SC-004)."
  }

  assert {
    condition     = length(aws_lb_listener.backend.default_action) == 1
    error_message = "Exactly one default action (FR-018)."
  }
}

# ---------------------------------------------------------------------------
# US4 — published contract and the cross-origin entry
# ---------------------------------------------------------------------------

run "published_contract" {
  command = apply

  assert {
    condition     = can(regex("^https://", output.staging_base_url))
    error_message = "The staging base URL must be an https URL (FR-050, SC-022)."
  }

  assert {
    condition     = output.cluster_name != "" && output.service_name != "" && output.log_group_name != ""
    error_message = "Every published identifier must be present (FR-050, SC-022)."
  }

  # Its only consumer is the FR-032 follow-up against SCRUM-174, which pins the
  # roles' trust condition against it. Without this output that follow-up has to
  # re-derive the ARN by hand.
  assert {
    condition     = can(regex("^arn:aws:ecs:", output.cluster_arn))
    error_message = "The cluster ARN must be published so the FR-032 follow-up can pin the role condition (FR-050, SC-021)."
  }

  # The log group name is constrained, not chosen: outside this scope the execution
  # role's log-write grant does not cover it and the task cannot start.
  assert {
    condition     = startswith(output.log_group_name, "/crewsafe/shared-dev/")
    error_message = "The log group must fall under the scope the secrets component's log-write grant covers (FR-030, SC-013)."
  }
}

run "cross_origin_entry" {
  command = apply

  assert {
    condition     = aws_ssm_parameter.cors_allowed_origins.name == "/crewsafe/shared-dev/cors/allowed-origins"
    error_message = "The entry must sit under the prefix the secrets component publishes and nowhere else (FR-038, SC-019)."
  }

  assert {
    condition     = aws_ssm_parameter.cors_allowed_origins.type == "String"
    error_message = "An origin list is not a secret (FR-038)."
  }

  assert {
    condition     = !can(regex("\\*", aws_ssm_parameter.cors_allowed_origins.value))
    error_message = "The origin list must be explicit, never a wildcard (FR-039, SC-019)."
  }
}

# The base URL must be DERIVED from the distribution, not written as a literal. A
# distribution replacement issues a new domain name; a literal would survive the
# replacement while silently addressing nothing.
#
# The proof is that the mocked provider fabricates a DIFFERENT random domain_name on
# every run, and the assertion still holds. A hard-coded value in outputs.tf could
# not track that, so this cannot pass by coincidence.
#
# (An override_resource sentinel was tried first and is not used: with a
# mock_provider in play the run-level override did not reach domain_name, so the
# assertion would have compared against the mock's value and proved nothing. Tracking
# the fabricated value is the formulation that actually bites.)
run "base_url_is_derived_not_literal" {
  command = apply

  assert {
    condition     = output.staging_base_url == "https://${aws_cloudfront_distribution.main.domain_name}"
    error_message = "staging_base_url must be derived from the distribution's domain name, not hard-coded."
  }

  assert {
    condition     = !startswith(aws_cloudfront_distribution.main.domain_name, "https://")
    error_message = "Sanity check on the assertion above: the scheme must come from the output expression, not from the domain name."
  }
}
