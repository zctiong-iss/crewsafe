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
#   2. "boundary" — the public ALB must stay in public subnets while accepting
#      port 80 only from CloudFront's managed origin-facing prefix list. Its
#      application-group ingress and egress stay restricted to port 8080 by
#      security-group reference.
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
      public_subnet_ids     = ["subnet-0public0000000a", "subnet-0public0000000b"]
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
      repository_url            = "123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/crewsafe/backend"
      repository_arn            = "arn:aws:ecr:ap-southeast-1:123456789012:repository/crewsafe/backend"
      ml_service_repository_url = "123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/crewsafe/ml-service"
      ml_service_repository_arn = "arn:aws:ecr:ap-southeast-1:123456789012:repository/crewsafe/ml-service"
      ml_service_push_role_arn  = "arn:aws:iam::123456789012:role/crewsafe-shared-dev-ecr-ml-service-push"
    }
  }
}

override_data {
  target = data.terraform_remote_state.cognito
  values = {
    outputs = {
      domain_url = "https://crewsafe-shared-dev.auth.ap-southeast-1.amazoncognito.com"
    }
  }
}

# SCRUM-371 — the crewsafe-developers group this component attaches its new
# grant to, published by developer-access-shared-dev (SCRUM-372).
override_data {
  target = data.terraform_remote_state.developer_access
  values = {
    outputs = {
      developer_group_name = "crewsafe-developers"
    }
  }
}

# AWS-published. Preparation assertions prove this managed identifier is the
# public ALB's only ingress source rather than a caller-supplied CIDR.
override_data {
  target = data.aws_ec2_managed_prefix_list.cloudfront
  values = { id = "pl-00a54069" }
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
  expected_account_id          = "123456789012"
  account_alias                = "crewsafe-dev"
  initial_image_tag            = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"
  initial_ml_service_image_tag = "b2c3d4e5f60718293a4b5c6d7e8f90123456789a"
  # SCRUM-298: required, no default (FR-017, FR-022) — reuses the exact fixture
  # value infra/terraform/ecr/tests/ecr.tftest.hcl already established.
  github_oidc_main_subject = "repo:owner@267492605/crewsafe@1310783821:ref:refs/heads/main"
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

run "structured_log_shipping" {
  command = apply

  assert {
    condition     = jsondecode(aws_ecs_task_definition.backend.container_definitions)[0].logConfiguration.logDriver == "awslogs"
    error_message = "The backend task must ship stdout and stderr through the ECS awslogs driver."
  }

  assert {
    condition     = jsondecode(aws_ecs_task_definition.backend.container_definitions)[0].logConfiguration.options["awslogs-group"] == aws_cloudwatch_log_group.backend.name
    error_message = "The backend task must use the component-owned CloudWatch log group."
  }

  assert {
    condition     = jsondecode(aws_ecs_task_definition.backend.container_definitions)[0].logConfiguration.options["mode"] == "non-blocking"
    error_message = "The ECS awslogs driver must use non-blocking mode."
  }

  assert {
    condition     = jsondecode(aws_ecs_task_definition.backend.container_definitions)[0].logConfiguration.options["max-buffer-size"] == "25m"
    error_message = "The non-blocking ECS log buffer must remain explicitly bounded."
  }

  assert {
    condition     = length(jsondecode(aws_ecs_task_definition.backend.container_definitions)[0].environment) == 0
    error_message = "Plaintext container environment values must remain absent from the backend task definition."
  }
}

# SCRUM-204 US3 — the verified public path becomes the only runtime attachment.
# Legacy-resource absence is categorical and therefore covered by the source
# guard; these provider-backed assertions prove the surviving topology.
run "public_origin_cleanup" {
  command = apply

  assert {
    condition     = aws_lb.public.internal == false
    error_message = "Cleanup must preserve the active internet-facing public ALB."
  }

  assert {
    condition = tolist(aws_lb.public.subnets) == tolist([
      "subnet-0public0000000a", "subnet-0public0000000b"
    ])
    error_message = "The parallel public ALB must use exactly the network component's public subnets."
  }

  assert {
    condition     = aws_vpc_security_group_ingress_rule.public_lb_from_cloudfront.prefix_list_id == data.aws_ec2_managed_prefix_list.cloudfront.id
    error_message = "Public-origin ingress must reference AWS's managed CloudFront origin-facing prefix list."
  }

  assert {
    condition     = aws_vpc_security_group_ingress_rule.public_lb_from_cloudfront.cidr_ipv4 == null
    error_message = "No CIDR may admit traffic to the public ALB; the managed prefix list is its only source."
  }

  assert {
    condition     = aws_vpc_security_group_ingress_rule.public_lb_from_cloudfront.from_port == 80 && aws_vpc_security_group_ingress_rule.public_lb_from_cloudfront.to_port == 80
    error_message = "CloudFront may reach only the public ALB's HTTP listener port."
  }

  assert {
    condition     = aws_vpc_security_group_egress_rule.public_lb_to_app.referenced_security_group_id == "sg-0app00000000000000"
    error_message = "The public ALB may send traffic only to the existing application security group."
  }

  assert {
    condition     = aws_vpc_security_group_egress_rule.public_lb_to_app.from_port == 8080 && aws_vpc_security_group_egress_rule.public_lb_to_app.to_port == 8080
    error_message = "The public ALB may send traffic only to the application port."
  }

  assert {
    condition     = aws_vpc_security_group_ingress_rule.app_from_public_lb.security_group_id == "sg-0app00000000000000" && aws_vpc_security_group_ingress_rule.app_from_public_lb.referenced_security_group_id == aws_security_group.public_lb.id
    error_message = "Application ingress must name the parallel ALB security group, never an address range."
  }

  assert {
    condition     = aws_vpc_security_group_ingress_rule.app_from_public_lb.cidr_ipv4 == null && aws_vpc_security_group_ingress_rule.app_from_public_lb.from_port == 8080 && aws_vpc_security_group_ingress_rule.app_from_public_lb.to_port == 8080
    error_message = "The parallel ALB may enter the application group by security-group reference on port 8080 only."
  }

  assert {
    condition     = aws_lb_listener.public.default_action[0].type == "forward" && aws_lb_listener.public.default_action[0].target_group_arn == aws_lb_target_group.public.arn
    error_message = "The public listener must forward to its distinct target group and never answer on the application's behalf."
  }

  assert {
    condition     = aws_lb_target_group.public.health_check[0].path == "/actuator/health" && aws_lb_target_group.public.health_check[0].matcher == "200"
    error_message = "The parallel target group must expose the existing application health signal before cutover."
  }

  assert {
    condition = toset([
      for attachment in aws_ecs_service.backend.load_balancer : attachment.target_group_arn
    ]) == toset([aws_lb_target_group.public.arn])
    error_message = "Cleanup must leave exactly the active public target-group attachment."
  }

  assert {
    condition     = one(aws_cloudfront_distribution.main.origin).domain_name == aws_lb.public.dns_name
    error_message = "Cleanup must preserve the existing backend origin on the verified public ALB."
  }

  assert {
    condition     = one(one(aws_cloudfront_distribution.main.origin).custom_origin_config).origin_protocol_policy == "http-only"
    error_message = "CloudFront must reach the temporary public origin over the reviewed HTTP-only transport."
  }

  assert {
    condition     = one(one(aws_cloudfront_distribution.main.origin).custom_origin_config).http_port == 80
    error_message = "The custom origin must use only the prefix-list-fenced public listener on port 80."
  }
}

run "public_edge" {
  command = apply

  assert {
    condition     = one(aws_cloudfront_distribution.main.origin).domain_name == aws_lb.public.dns_name
    error_message = "The stable distribution must select the verified public ALB after cutover."
  }

  assert {
    condition     = aws_cloudfront_distribution.main.default_cache_behavior[0].viewer_protocol_policy == "redirect-to-https"
    error_message = "Plaintext must redirect, never be served (FR-025, SC-002)."
  }

  # This assertion used to require "TLSv1.2_2021" and it was testing an aspiration, not a
  # fact. The CloudFront API ignores minimum_protocol_version when
  # cloudfront_default_certificate is set and pins the policy to TLSv1 — so the assertion
  # passed against the CONFIG while the DEPLOYED distribution accepted TLS 1.0, and
  # produced a diff that could never converge (plan run 30874184699).
  #
  # It now asserts the value AWS will actually honour. That is a weaker guarantee, stated
  # honestly, rather than a stronger one that was never true.
  assert {
    condition     = aws_cloudfront_distribution.main.viewer_certificate[0].minimum_protocol_version == "TLSv1"
    error_message = "With the default certificate, TLSv1 is the only value CloudFront honours. Anything else is a phantom diff that never converges. Raising the floor needs a custom certificate on a controlled domain, which is its own issue."
  }

  # The distribution must serve on the provider-issued name, which is the whole reason the
  # TLS floor above cannot be raised. Asserted so the coupling between the two is visible:
  # if this ever becomes false, the assertion above should be revisited.
  assert {
    condition     = aws_cloudfront_distribution.main.viewer_certificate[0].cloudfront_default_certificate == true
    error_message = "The distribution uses the provider-issued certificate. Switching to a custom one is what unlocks a TLS 1.2 floor — change both assertions together."
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

  assert {
    condition     = jsondecode(aws_ecs_task_definition.backend.container_definitions)[0].user == "1000"
    error_message = "The container must run as a non-root user (FR-014, SC-015)."
  }

  # These two assert an ABSENCE, and the absence is the fix rather than an omission.
  #
  # On Fargate a non-root container cannot have both a read-only root filesystem and
  # writable scratch: tmpfs is unsupported, and a bind mount is created root-owned at
  # 0755 so uid 1000 cannot write to it (aws/containers-roadmap#938, still open). The
  # earlier version of this component asserted BOTH and the first task died with
  # `AccessDeniedException: /tmp/tomcat.8080.<n>` before serving anything.
  #
  # The pair below is what keeps a well-meaning "restore the hardening" edit from
  # reintroducing that outage: adding either one back fails here.
  assert {
    condition     = jsondecode(aws_ecs_task_definition.backend.container_definitions)[0].readonlyRootFilesystem == false
    error_message = "readonlyRootFilesystem must stay false while the container runs as non-root on Fargate — see the note in main.tf. Restoring it needs a managed EBS volume or a root init container, which is its own decision."
  }

  assert {
    condition = length([
      for mount in try(jsondecode(aws_ecs_task_definition.backend.container_definitions)[0].mountPoints, []) : mount if mount.containerPath == "/tmp"
    ]) == 0
    error_message = "No bind mount may be placed at /tmp. Fargate creates it root-owned at 0755, which SHADOWS the image's writable /tmp and stops the JVM and Tomcat from allocating scratch — the exact startup failure this looks like it prevents."
  }

  assert {
    condition     = length(aws_ecs_task_definition.backend.volume) == 0
    error_message = "No volume should be declared. The only one this component ever needed was the /tmp scratch mount that Fargate cannot make writable for a non-root user."
  }

  # SCRUM-373 — deliberately widened from "exactly one" to "exactly two": the
  # ml-service container is a same-task sidecar (spec FR-003), not the
  # out-of-band migration-step shape FR-011/FR-037 originally ruled out. The
  # count stays closed at two so a THIRD container cannot quietly join later.
  assert {
    condition     = length(jsondecode(aws_ecs_task_definition.backend.container_definitions)) == 2
    error_message = "Exactly two containers: backend and its ml-service sidecar (spec FR-003). A third would need its own deliberate review (FR-011, FR-037)."
  }

  assert {
    condition     = length([for c in jsondecode(aws_ecs_task_definition.backend.container_definitions) : c if can(c.command)]) == 0
    error_message = "No command override — the image starts the application, and an override is how a migration gets run separately from the process serving traffic (FR-037)."
  }
}

# ---------------------------------------------------------------------------
# SCRUM-373 — the ml-service sidecar container (data-model.md)
# ---------------------------------------------------------------------------

run "ml_service_container_shape" {
  command = apply

  assert {
    condition     = jsondecode(aws_ecs_task_definition.backend.container_definitions)[1].name == "ml-service"
    error_message = "The second container must be named ml-service (data-model.md)."
  }

  assert {
    condition     = jsondecode(aws_ecs_task_definition.backend.container_definitions)[1].image == "123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/crewsafe/ml-service:${var.initial_ml_service_image_tag}"
    error_message = "The ml-service image reference must be the ml-service repository URL joined with its own commit-SHA tag (research.md R-009)."
  }

  assert {
    condition = tolist(jsondecode(aws_ecs_task_definition.backend.container_definitions)[1].portMappings) == tolist([
      { containerPort = 8000, protocol = "tcp" }
    ])
    error_message = "ml-service must listen on exactly port 8000/tcp and no other (spec FR-003)."
  }

  assert {
    condition     = jsondecode(aws_ecs_task_definition.backend.container_definitions)[1].essential == true
    error_message = "ml-service must be essential — a crash takes the whole task down, the accepted trade-off (spec Known trade-off)."
  }

  assert {
    condition     = jsondecode(aws_ecs_task_definition.backend.container_definitions)[1].user == "1000"
    error_message = "ml-service must run as the non-root user its image already defines (spec FR-004)."
  }

  assert {
    condition     = length(jsondecode(aws_ecs_task_definition.backend.container_definitions)[1].environment) == 0
    error_message = "Plaintext container environment values must remain absent from the ml-service container, matching backend's own convention."
  }

  assert {
    condition = sort([
      for entry in jsondecode(aws_ecs_task_definition.backend.container_definitions)[1].secrets : entry.name
    ]) == sort(["WBGT_MODEL_MANIFEST", "WBGT_MODEL_MANIFEST_SHA256"])
    error_message = "ml-service must receive exactly the two deferred model-manifest slots as secret references, nothing else (spec FR-008)."
  }

  assert {
    condition = alltrue([
      for entry in jsondecode(aws_ecs_task_definition.backend.container_definitions)[1].secrets :
      startswith(entry.valueFrom, "arn:aws:ssm:ap-southeast-1:123456789012:parameter/crewsafe/shared-dev/ml/")
    ])
    error_message = "Both ml-service secret references must resolve under the secrets component's published config_parameter_prefix (spec FR-008)."
  }

  assert {
    condition     = jsondecode(aws_ecs_task_definition.backend.container_definitions)[1].logConfiguration.logDriver == "awslogs"
    error_message = "ml-service must ship stdout/stderr through the ECS awslogs driver, matching backend's convention."
  }

  assert {
    condition     = jsondecode(aws_ecs_task_definition.backend.container_definitions)[1].logConfiguration.options["awslogs-group"] == aws_cloudwatch_log_group.ml_service.name
    error_message = "ml-service must use its own, dedicated CloudWatch log group — never sharing backend's stream (spec FR-003)."
  }

  assert {
    condition     = aws_cloudwatch_log_group.ml_service.name != aws_cloudwatch_log_group.backend.name
    error_message = "The two containers' log groups must be distinct, or an ml-service failure is indistinguishable from a backend one (spec User Story 3)."
  }

  assert {
    condition     = length([for c in jsondecode(aws_ecs_task_definition.backend.container_definitions) : c if can(c.command)]) == 0
    error_message = "Neither container may carry a command override."
  }
}

# SC-004 — ml-service must stay unreachable from outside the task. No load
# balancer, listener, or security-group rule may reference its port or name.
run "ml_service_unreachable_from_outside" {
  command = apply

  assert {
    condition     = !can(regex("ml-service", jsonencode(aws_lb_target_group.public))) && !can(regex("8000", jsonencode(aws_lb_target_group.public.health_check)))
    error_message = "The public target group must not reference ml-service or its port (spec SC-004)."
  }

  assert {
    condition     = aws_vpc_security_group_egress_rule.public_lb_to_app.to_port != 8000 && aws_vpc_security_group_ingress_rule.app_from_public_lb.to_port != 8000
    error_message = "No security-group rule may open port 8000 — ml-service is reachable only over localhost inside the task (spec SC-004)."
  }

  assert {
    condition = toset([
      for attachment in aws_ecs_service.backend.load_balancer : attachment.container_name
    ]) == toset(["backend"])
    error_message = "Only the backend container may be attached to a load balancer target group (spec FR-003, SC-004)."
  }
}

run "task_sizing" {
  command = apply

  assert {
    condition     = aws_ecs_task_definition.backend.cpu == "1024"
    error_message = "task_cpu must be re-sized to 1024 for both containers running together (spec FR-005, research.md R-007)."
  }

  assert {
    condition     = aws_ecs_task_definition.backend.memory == "4096"
    error_message = "task_memory must be re-sized to 4096 for both containers running together, with real headroom above the 2048 MiB floor Fargate allows at 1024 CPU (spec FR-005, research.md R-007)."
  }
}

# ---------------------------------------------------------------------------
# Health drives traffic
# ---------------------------------------------------------------------------

run "health_drives_traffic" {
  command = apply

  assert {
    condition     = aws_lb_target_group.public.health_check[0].path == "/actuator/health"
    error_message = "The probe must ask the application, not the root path or a synthetic port check (FR-026, SC-016)."
  }

  assert {
    condition     = aws_lb_target_group.public.health_check[0].matcher == "200"
    error_message = "Actuator returns 503 when down; only 200 may count as healthy (SC-016)."
  }

  assert {
    condition     = aws_lb_target_group.public.health_check[0].port == "traffic-port"
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
    condition     = aws_lb_listener.public.default_action[0].type == "forward"
    error_message = "The listener must forward. A fixed-response or redirect action is a path to the endpoint that bypasses the application (FR-018, SC-004)."
  }

  assert {
    condition     = length(aws_lb_listener.public.default_action) == 1
    error_message = "Exactly one default action (FR-018)."
  }
}

# ---------------------------------------------------------------------------
# SCRUM-371 — ECS Exec access to shared-dev RDS
# ---------------------------------------------------------------------------

run "ecs_exec_enabled" {
  command = apply

  assert {
    condition     = aws_ecs_service.backend.enable_execute_command == true
    error_message = "The backend service must opt into ECS Exec so a developer's session can host through it (spec FR-001)."
  }
}

# contracts/rds-troubleshooting-grant.md is the audit surface this run block
# holds the resource to. Decodes the actual attached policy JSON, never the
# input local (037's R-009 finding, reused): a mock fabricates a data source's
# .json attribute, so asserting against the local is the only way to test the
# real configuration rather than invented data.
run "developer_rds_troubleshooting_grant" {
  command = apply

  assert {
    condition     = length(jsondecode(aws_iam_group_policy.developers_rds_troubleshooting.policy).Statement) == 3
    error_message = "The grant must hold exactly three statements: ExecIntoBackendTask, StartSessionToBackendTask, and ReadRdsManagedCredentialForTunnel (spec FR-005, research.md R-005 amendment)."
  }

  assert {
    condition = sort([
      for s in jsondecode(aws_iam_group_policy.developers_rds_troubleshooting.policy).Statement : s.Sid
    ]) == sort(["ExecIntoBackendTask", "StartSessionToBackendTask", "ReadRdsManagedCredentialForTunnel"])
    error_message = "The grant's three statements must be exactly these, no others (contracts/rds-troubleshooting-grant.md)."
  }

  assert {
    condition = sort(flatten([
      for s in jsondecode(aws_iam_group_policy.developers_rds_troubleshooting.policy).Statement : s.Action
    ])) == sort(["ecs:ExecuteCommand", "secretsmanager:GetSecretValue", "ssm:StartSession"])
    error_message = "The grant must total exactly ecs:ExecuteCommand, ssm:StartSession, and secretsmanager:GetSecretValue — no restatement of ViewOnlyAccess's existing coverage (spec FR-005, FR-006)."
  }

  # Resource is a JSON string on two statements and a JSON array on
  # StartSessionToBackendTask (it needs both the task ARN and the SSM document
  # ARN); normalize to a list before checking for a wildcard so neither shape
  # is missed.
  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_group_policy.developers_rds_troubleshooting.policy).Statement :
      alltrue([for r in try(tolist(s.Resource), [s.Resource]) : r != "*"])
    ])
    error_message = "No statement may use a resource wildcard — every action here supports scoping and FR-007 requires it, unlike the one ssmmessages exception on the secrets side (spec FR-007)."
  }

  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_group_policy.developers_rds_troubleshooting.policy).Statement :
      strcontains(s.Resource, local.name_prefix)
      if s.Sid == "ExecIntoBackendTask"
    ])
    error_message = "ExecIntoBackendTask must be scoped to this project's own ECS cluster/task pattern, not every task in the account (spec FR-007, research.md R-005)."
  }

  # Amendment (live-tested 2026-08-14): ssm:StartSession for ECS Exec
  # port-forwarding is authorized against BOTH the task target and the SSM
  # document — confirmed by a live AccessDeniedException naming exactly this
  # document ARN when only the task ARN was granted (research.md R-005).
  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_group_policy.developers_rds_troubleshooting.policy).Statement :
      (
        strcontains(join(",", s.Resource), local.name_prefix)
        && strcontains(join(",", s.Resource), "document/AWS-StartPortForwardingSessionToRemoteHost")
      )
      if s.Sid == "StartSessionToBackendTask"
    ])
    error_message = "StartSessionToBackendTask must grant ssm:StartSession on both the backend task ARN pattern and the AWS-StartPortForwardingSessionToRemoteHost document ARN (research.md R-005 amendment)."
  }

  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_group_policy.developers_rds_troubleshooting.policy).Statement :
      strcontains(s.Resource, ":secret:rds!")
      if s.Sid == "ReadRdsManagedCredentialForTunnel"
    ])
    error_message = "ReadRdsManagedCredentialForTunnel must be scoped to the RDS-managed secret's naming pattern, matching secrets/main.tf's own rds_managed_secret_arn_pattern (spec FR-007, Key Entities)."
  }

  assert {
    condition     = aws_iam_group_policy.developers_rds_troubleshooting.group == "crewsafe-developers"
    error_message = "Must attach to the group published by developer-access's remote state, never a hardcoded second group (contracts/developer-access-consumer-compliance.md rule 1)."
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

  assert {
    condition     = aws_ssm_parameter.cors_allowed_origins.value == "https://d3b75ru76gta2n.cloudfront.net"
    error_message = "Staging must permit only the deployed web origin (SCRUM-242)."
  }

  assert {
    condition     = !strcontains(aws_ssm_parameter.cors_allowed_origins.value, "http://localhost:5173") && !strcontains(aws_ssm_parameter.cors_allowed_origins.value, "http://localhost:8081")
    error_message = "Staging must not retain localhost browser origins after SCRUM-242."
  }

  # The synthetic-user mappings. This entry exists because the application requires the
  # property to be PRESENT: DemoDataSeeder runs under the staging profile and throws on a
  # null value rather than seeding nothing, 60 seconds into startup and after the port is
  # bound. It is created here rather than referenced from the secrets component because a
  # `secrets` reference to a parameter that does not exist fails the container start
  # outright — the same rule that keeps NEA_API_KEY absent (FR-033).
  assert {
    condition     = aws_ssm_parameter.demo_users_json.name == "/crewsafe/shared-dev/cognito/demo-users-json"
    error_message = "The mappings entry must sit under the prefix the secrets component publishes, so the execution role's prefix-scoped read grant covers it without a change to that component."
  }

  assert {
    condition     = aws_ssm_parameter.demo_users_json.type == "String"
    error_message = "The mappings are fictional identities, not a credential — usernames, subject identifiers, roles and site codes."
  }

  assert {
    condition     = can(jsondecode(aws_ssm_parameter.demo_users_json.value))
    error_message = "The value must parse as JSON. A malformed value fails the task at startup, not at plan time, so plan-time validation is the only place it can be caught cheaply."
  }

  # The reference must be to the resource, not a reconstructed string. A string would
  # plan clean while leaving Terraform free to create the task definition BEFORE the
  # parameter, and a task definition pointing at a parameter that does not yet exist
  # fails the container start.
  assert {
    condition = length([
      for s in jsondecode(aws_ecs_task_definition.backend.container_definitions)[0].secrets : s
      if s.name == "APP_COGNITO_DEMO_USERS_JSON" && endswith(s.valueFrom, aws_ssm_parameter.demo_users_json.name)
    ]) == 1
    error_message = "The task definition must inject APP_COGNITO_DEMO_USERS_JSON from the parameter this component creates. Without it the application starts, binds the port, and then dies in DemoDataSeeder."
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

# ---------------------------------------------------------------------------
# SCRUM-298 — web static hosting runtime and staging origin
#
# The web-hosting resources need no VPC, subnet, security-group, secret, or
# database remote state. The browser policy consumes Cognito's published
# domain_url, which is supplied by the offline override_data above.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Foundational — the sync role's identity and permissions (research.md R-005, R-006)
# ---------------------------------------------------------------------------

run "web_sync_role_trust_policy" {
  command = apply

  # The role is assumed exclusively by a GitHub Actions workflow_dispatch run on
  # main, via OIDC — never a human's local session (FR-017, Q2).
  assert {
    condition = anytrue([
      for stmt in jsondecode(aws_iam_role.web_sync.assume_role_policy).Statement :
      stmt.Action == "sts:AssumeRoleWithWebIdentity" &&
      try(stmt.Condition.StringEquals["token.actions.githubusercontent.com:sub"], "") == var.github_oidc_main_subject
    ])
    error_message = "The sync role's trust policy must condition on the exact var.github_oidc_main_subject value (FR-017, research.md R-005)."
  }

  assert {
    condition = length([
      for stmt in jsondecode(aws_iam_role.web_sync.assume_role_policy).Statement :
      stmt if stmt.Action == "sts:AssumeRole"
    ]) == 0
    error_message = "The sync role must be assumable only via AssumeRoleWithWebIdentity (OIDC), never a plain AssumeRole (FR-017)."
  }
}

run "web_sync_role_permissions" {
  command = apply

  # Exactly two statements: one scoped to the web bucket, one to the verified
  # web distribution and its response-headers policy. Nothing broader
  # (research.md R-006, FR-015).
  assert {
    condition     = length(jsondecode(aws_iam_role_policy.web_sync.policy).Statement) == 2
    error_message = "The sync role's permissions policy must declare exactly two statements — one for the bucket, one for the distribution (research.md R-006)."
  }

  assert {
    condition = anytrue([
      for stmt in jsondecode(aws_iam_role_policy.web_sync.policy).Statement :
      toset(stmt.Action) == toset(["s3:ListBucket", "s3:GetObject", "s3:PutObject", "s3:DeleteObject"])
    ])
    error_message = "The bucket statement must grant exactly ListBucket/GetObject/PutObject/DeleteObject — no broader S3 action (research.md R-006)."
  }

  assert {
    condition = anytrue([
      for stmt in jsondecode(aws_iam_role_policy.web_sync.policy).Statement :
      toset(stmt.Action) == toset([
        "cloudfront:CreateInvalidation",
        "cloudfront:GetDistributionConfig",
        "cloudfront:GetResponseHeadersPolicy",
        ]) && toset(stmt.Resource) == toset([
        aws_cloudfront_distribution.web.arn,
        "arn:aws:cloudfront::${var.expected_account_id}:response-headers-policy/${aws_cloudfront_response_headers_policy.web_security.id}",
      ])
    ])
    error_message = "The CloudFront statement must grant only invalidation plus the two exact read actions on the distribution and its response-headers policy."
  }

  # research.md R-006: cloudfront:GetInvalidation is deliberately absent — the
  # workflow issues an invalidation and returns, it does not poll for completion.
  assert {
    condition = length([
      for stmt in jsondecode(aws_iam_role_policy.web_sync.policy).Statement :
      stmt if contains(stmt.Action, "cloudfront:GetInvalidation")
    ]) == 0
    error_message = "cloudfront:GetInvalidation must be absent — the sync workflow does not wait for invalidation completion (research.md R-006)."
  }
}

# SCRUM-303 — mapping publication is deliberately a separate OIDC identity from
# ordinary backend deployment. The assertions hold the trust, exact write target,
# and the intentionally absent identity/secret read permissions together.
run "mapping_publication_role_boundary" {
  command = apply

  assert {
    condition = anytrue([
      for stmt in jsondecode(aws_iam_role.cognito_mapping_publication.assume_role_policy).Statement :
      stmt.Action == "sts:AssumeRoleWithWebIdentity" &&
      try(stmt.Condition.StringEquals["token.actions.githubusercontent.com:sub"], "") == var.github_oidc_main_subject
    ])
    error_message = "The mapping-publication role must trust only the exact main-branch GitHub OIDC subject."
  }

  assert {
    condition = anytrue([
      for stmt in jsondecode(aws_iam_role_policy.cognito_mapping_publication.policy).Statement :
      contains(stmt.Action, "ssm:PutParameter") &&
      try(toset(stmt.Resource), toset([])) == toset([aws_ssm_parameter.demo_users_json.arn])
    ])
    error_message = "The mapping-publication role may write only the fixed runtime mapping parameter."
  }

  assert {
    condition = length(flatten([
      for stmt in jsondecode(aws_iam_role_policy.cognito_mapping_publication.policy).Statement : [
        for action in stmt.Action : action if can(regex("^(cognito-idp:|secretsmanager:|ssm:Get|ssm:Describe)", action))
      ]
    ])) == 0
    error_message = "The mapping-publication role must not read mappings, access Cognito, or access Secrets Manager."
  }

  assert {
    condition = anytrue([
      for stmt in jsondecode(aws_iam_role_policy.cognito_mapping_publication.policy).Statement :
      toset(stmt.Action) == toset(["iam:PassRole"]) &&
      try(toset(stmt.Resource), toset([])) == toset([local.secrets.task_execution_role_arn, local.secrets.task_role_arn]) &&
      try(stmt.Condition.StringEquals["iam:PassedToService"], "") == "ecs-tasks.amazonaws.com"
    ])
    error_message = "Task-role passing must be limited to the existing backend execution and task roles for ECS tasks."
  }
}

# SCRUM-373 follow-up: ml-service's own out-of-band redeploy role, mirroring
# backend_deploy's shape (same trust condition, same shared aws_ecs_service.backend
# target — a second ECS service does not exist to scope this any narrower) but
# scoped to the ml-service ECR repository rather than backend's.
run "ml_service_deploy_role_boundary" {
  command = apply

  assert {
    condition = anytrue([
      for stmt in jsondecode(aws_iam_role.ml_service_deploy.assume_role_policy).Statement :
      stmt.Action == "sts:AssumeRoleWithWebIdentity" &&
      try(stmt.Condition.StringEquals["token.actions.githubusercontent.com:sub"], "") == var.github_oidc_main_subject
    ])
    error_message = "The ml-service deploy role must trust only the exact main-branch GitHub OIDC subject."
  }

  assert {
    condition = anytrue([
      for stmt in jsondecode(aws_iam_role_policy.ml_service_deploy.policy).Statement :
      toset(stmt.Action) == toset(["ecr:DescribeImages"]) &&
      try(stmt.Resource, "") == local.ecr.ml_service_repository_arn
    ])
    error_message = "The ml-service deploy role must read image metadata only from the ml-service ECR repository, never the backend one."
  }

  assert {
    condition = anytrue([
      for stmt in jsondecode(aws_iam_role_policy.ml_service_deploy.policy).Statement :
      toset(stmt.Action) == toset(["ecs:DescribeServices", "ecs:UpdateService"]) &&
      try(stmt.Resource, "") == aws_ecs_service.backend.id
    ])
    error_message = "The ml-service deploy role's UpdateService grant must be scoped to the one shared backend service (no narrower target exists)."
  }

  assert {
    condition = anytrue([
      for stmt in jsondecode(aws_iam_role_policy.ml_service_deploy.policy).Statement :
      toset(stmt.Action) == toset(["iam:PassRole"]) &&
      try(toset(stmt.Resource), toset([])) == toset([local.secrets.task_execution_role_arn, local.secrets.task_role_arn]) &&
      try(stmt.Condition.StringEquals["iam:PassedToService"], "") == "ecs-tasks.amazonaws.com"
    ])
    error_message = "Task-role passing must be limited to the existing backend execution and task roles for ECS tasks."
  }

  # Never a Terraform apply role - this deploy role stands alone from the
  # reviewed plan/apply CI policies, matching backend_deploy's own boundary.
  assert {
    condition = alltrue([
      for stmt in jsondecode(aws_iam_role_policy.ml_service_deploy.policy).Statement :
      length([for a in stmt.Action : a if can(regex("^ssm:(Put|Delete)|^ecs:(DeleteService|DeregisterTaskDefinition)", a))]) == 0
    ])
    error_message = "The ml-service deploy role must never gain a write action beyond registering a task definition and updating the one service it targets."
  }
}

# ---------------------------------------------------------------------------
# US1 — reach the deployed web app over a stable HTTPS origin, independent of
# the backend's own domain
# ---------------------------------------------------------------------------

run "web_bucket_privacy" {
  command = apply

  assert {
    condition = (
      aws_s3_bucket_public_access_block.web.block_public_acls &&
      aws_s3_bucket_public_access_block.web.block_public_policy &&
      aws_s3_bucket_public_access_block.web.ignore_public_acls &&
      aws_s3_bucket_public_access_block.web.restrict_public_buckets
    )
    error_message = "All four public-access-block flags must be true (FR-002)."
  }

  assert {
    condition     = aws_s3_bucket_ownership_controls.web.rule[0].object_ownership == "BucketOwnerEnforced"
    error_message = "Object ownership must be BucketOwnerEnforced, disabling ACLs entirely (FR-002)."
  }
}

run "web_bucket_versioning_and_lifecycle" {
  command = apply

  assert {
    condition     = aws_s3_bucket_versioning.web.versioning_configuration[0].status == "Enabled"
    error_message = "Versioning must be enabled (FR-006)."
  }

  assert {
    condition     = length(aws_s3_bucket_server_side_encryption_configuration.web.rule) == 1
    error_message = "Server-side encryption must be configured (FR-006)."
  }

  assert {
    condition     = aws_s3_bucket_lifecycle_configuration.web.rule[0].noncurrent_version_expiration[0].noncurrent_days == var.web_bucket_noncurrent_version_expiration_days
    error_message = "Noncurrent versions must expire after the configured number of days (research.md R-009)."
  }
}

run "web_oac_and_bucket_policy" {
  command = apply

  assert {
    condition     = aws_cloudfront_origin_access_control.web.signing_behavior == "always"
    error_message = "OAC signing_behavior must be always (FR-004)."
  }

  assert {
    condition     = aws_cloudfront_origin_access_control.web.origin_access_control_origin_type == "s3"
    error_message = "OAC must be scoped to an s3 origin (FR-004)."
  }

  # The bucket policy must name this EXACT distribution — a reference, not a
  # reconstructed string, so a distribution replacement cannot silently leave a
  # stale ARN behind (FR-005).
  assert {
    condition = anytrue([
      for stmt in jsondecode(aws_s3_bucket_policy.web.policy).Statement :
      stmt.Principal.Service == "cloudfront.amazonaws.com" &&
      try(stmt.Condition.StringEquals["AWS:SourceArn"], "") == aws_cloudfront_distribution.web.arn
    ])
    error_message = "The bucket policy must grant read access only to this exact distribution ARN, by reference (FR-005)."
  }

  assert {
    condition = alltrue([
      for stmt in jsondecode(aws_s3_bucket_policy.web.policy).Statement :
      stmt.Principal != "*" && (try(stmt.Condition.StringEquals["AWS:SourceArn"], "no-wildcard") != "*")
    ])
    error_message = "No bucket policy statement may use a wildcard principal or SourceArn (FR-005)."
  }
}

run "web_distribution_edge" {
  command = apply

  assert {
    condition     = anytrue([for b in aws_cloudfront_distribution.web.default_cache_behavior : b.viewer_protocol_policy == "redirect-to-https"])
    error_message = "Plaintext requests must be redirected to HTTPS, never served (FR-009)."
  }

  assert {
    condition     = aws_cloudfront_distribution.web.viewer_certificate[0].minimum_protocol_version == "TLSv1"
    error_message = "The minimum protocol version must be the honest value the default certificate actually enforces, not an unsatisfiable aspirational one (FR-013, research.md R-008)."
  }

  assert {
    condition     = aws_cloudfront_distribution.web.viewer_certificate[0].cloudfront_default_certificate == true
    error_message = "The distribution must use the provider default certificate — no custom domain exists (FR-008)."
  }

  assert {
    condition     = aws_cloudfront_distribution.web.default_root_object == "index.html"
    error_message = "default_root_object must be index.html so a request for / resolves through the same path OAC serves (research.md R-008)."
  }

  assert {
    condition     = length(aws_cloudfront_distribution.web.custom_error_response) == 2
    error_message = "Exactly two custom_error_response blocks must exist — one for 403, one for 404 (FR-010)."
  }

  assert {
    condition     = toset([for er in aws_cloudfront_distribution.web.custom_error_response : er.error_code]) == toset([403, 404])
    error_message = "The two custom_error_response blocks must cover exactly 403 and 404 (FR-010)."
  }

  assert {
    condition = alltrue([
      for er in aws_cloudfront_distribution.web.custom_error_response :
      tostring(er.response_code) == "200" && er.response_page_path == "/index.html"
    ])
    error_message = "Both 403 and 404 must map to a 200 response serving /index.html — the SPA fallback (FR-010)."
  }

  assert {
    condition = alltrue([
      for behavior in aws_cloudfront_distribution.web.default_cache_behavior :
      behavior.response_headers_policy_id == aws_cloudfront_response_headers_policy.web_security.id
    ])
    error_message = "The default web behaviour must attach the security response-headers policy."
  }

  assert {
    condition = alltrue([
      for behavior in aws_cloudfront_distribution.web.ordered_cache_behavior :
      behavior.path_pattern != "/index.html" ||
      behavior.response_headers_policy_id == aws_cloudfront_response_headers_policy.web_security.id
    ])
    error_message = "The /index.html behaviour must attach the security response-headers policy."
  }

  # FR-007's actual hostname-distinctness guarantee is the two separate
  # `aws_cloudfront_distribution` resource blocks in the configuration itself
  # (.main and .web) — not something a mocked plan can prove, since
  # mock_provider "aws" gives every instance of a resource TYPE the same
  # default arn. Verified for real against the applied distributions in
  # quickstart.md §4.
}

# ---------------------------------------------------------------------------
# US3 — publish a stable contract for SCRUM-242 and SCRUM-271 to consume
# ---------------------------------------------------------------------------

run "web_published_contract" {
  command = apply

  assert {
    condition     = output.web_staging_base_url == "https://${aws_cloudfront_distribution.web.domain_name}"
    error_message = "web_staging_base_url must be derived from the web distribution's domain name, not hard-coded (contracts/terraform-outputs.md)."
  }

  assert {
    condition     = !startswith(aws_cloudfront_distribution.web.domain_name, "https://")
    error_message = "Sanity check on the assertion above: the scheme must come from the output expression, not from the domain name."
  }

  assert {
    condition     = output.web_bucket_name == aws_s3_bucket.web.id
    error_message = "web_bucket_name must equal the bucket's own id (contracts/terraform-outputs.md)."
  }

  assert {
    condition     = output.web_sync_role_arn == aws_iam_role.web_sync.arn
    error_message = "web_sync_role_arn must equal the sync role's own arn (contracts/terraform-outputs.md)."
  }
}
