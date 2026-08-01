# Infrastructure tests for the crewsafe shared-dev database component (SCRUM-175).
#
# Every run block plans against a mocked provider, so no AWS account, credential,
# or network call is involved.
#
# Two groups of assertions are load-bearing rather than routine:
#
#   1. "reachability" — the instance must not be publicly accessible. The network
#      component recorded this as an obligation it could not enforce: a publicly
#      accessible instance in a private subnet still receives a public endpoint,
#      and no security group rule prevents it.
#   2. "derivation" — the connection URL and the narrowing credential grant must be
#      DERIVED from the instance, not written as literals. A restore produces a new
#      endpoint and a new service-managed credential; a literal would survive the
#      restore while silently addressing the dead instance.
#
# The derivation assertions work by pinning sentinel values through
# override_resource below. A literal implementation would not track the override;
# a derived one does. That is what makes them meaningful rather than tautological
# — the same reasoning the secrets component used when it chose jsonencode() over
# data "aws_iam_policy_document", whose json attribute a mock fabricates
# (research.md R-004).

mock_provider "aws" {}

# The mocked provider fabricates a random account id, which would trip the
# instance's account precondition in every run. Pin it once here so each run
# exercises what it is actually about; "rejects_mismatched_account" varies
# expected_account_id against this fixed identity to prove the precondition
# still bites.
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
      vpc_id                     = "vpc-0test00000000000"
      public_subnet_ids          = ["subnet-0public0000000a", "subnet-0public0000000b"]
      private_subnet_ids         = ["subnet-0private000000a", "subnet-0private000000b"]
      app_security_group_id      = "sg-0app00000000000000"
      database_security_group_id = "sg-0database000000000"
    }
  }
}

override_data {
  target = data.terraform_remote_state.secrets
  values = {
    outputs = {
      weather_api_key_secret_arn = "arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:crewsafe/shared-dev/weather-api-key-AbCdEf"
      config_parameter_prefix    = "/crewsafe/shared-dev"
      task_execution_role_arn    = "arn:aws:iam::123456789012:role/crewsafe-shared-dev-task-execution"
      task_role_arn              = "arn:aws:iam::123456789012:role/crewsafe-shared-dev-task"
      task_execution_role_name   = "crewsafe-shared-dev-task-execution"
    }
  }
}

# The sentinel values behind every derivation assertion (research.md R-004).
# These are attributes AWS assigns, so under a mocked provider they would be
# fabricated as arbitrary strings. Pinning them to recognisable values lets an
# assertion distinguish a derived value from a hard-coded one: a literal
# implementation would not contain "db-sentinel".
override_resource {
  target = aws_db_instance.main
  values = {
    address  = "db-sentinel.abc123.ap-southeast-1.rds.amazonaws.com"
    endpoint = "db-sentinel.abc123.ap-southeast-1.rds.amazonaws.com:5432"
    master_user_secret = [{
      secret_arn    = "arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:rds!db-sentinel-AbCdEf"
      kms_key_id    = "arn:aws:kms:ap-southeast-1:123456789012:key/sentinel"
      secret_status = "active"
    }]
  }
}

# FR-008 — the username has one definition, in the secrets component. Overridden
# here so the assertion checks a known value rather than one the mock fabricates.
override_data {
  target = data.aws_ssm_parameter.database_username
  values = { value = "crewsafe" }
}

variables {
  expected_account_id = "123456789012"
  account_alias       = "shared-dev"
  aws_region          = "ap-southeast-1"
}

# ---------------------------------------------------------------------------
# Input validation (SEC-002) — every dispatch input is untrusted.
#
# These use command = plan: a variable validation failure is raised before any
# resource is evaluated, so there is nothing to resolve.
# ---------------------------------------------------------------------------

run "rejects_malformed_account_id" {
  command = plan
  variables {
    expected_account_id = "12345"
  }
  expect_failures = [var.expected_account_id]
}

run "rejects_non_slug_account_alias" {
  command = plan
  variables {
    account_alias = "Shared_Dev"
  }
  expect_failures = [var.account_alias]
}

run "rejects_region_outside_ap_southeast_1" {
  command = plan
  variables {
    aws_region = "us-east-1"
  }
  expect_failures = [var.aws_region]
}

# FR-036 — a ceiling at or below the initial allocation disables autoscaling
# entirely, which is one of the two ways the requirement can be silently defeated.
run "rejects_storage_ceiling_not_above_allocation" {
  command = plan
  variables {
    allocated_storage     = 100
    max_allocated_storage = 100
  }
  expect_failures = [var.max_allocated_storage]
}

# FR-024 — anything below seven days does not satisfy the retention requirement,
# and zero disables automated backups outright.
run "rejects_short_backup_retention" {
  command = plan
  variables {
    backup_retention_days = 1
  }
  expect_failures = [var.backup_retention_days]
}

# FR-041, R-008 — a pinned minor version would make every plan after an automatic
# minor upgrade propose reverting it: perpetual diff noise that trains reviewers
# to skim, which is worse than the drift it reports.
run "rejects_pinned_minor_engine_version" {
  command = plan
  variables {
    engine_major_version = "16.4"
  }
  expect_failures = [var.engine_major_version]
}

# ---------------------------------------------------------------------------
# Reachability and placement (US1)
#
# Assertion runs use command = apply. On Terraform 1.10.5 the override_* blocks
# are not surfaced during the plan phase, and override_during does not exist
# until a later release. A mocked apply creates nothing; it resolves computed
# values so the assertions can evaluate.
# ---------------------------------------------------------------------------

run "instance_is_unreachable_from_the_internet" {
  command = apply

  # FR-004, SC-006. The single most important assertion in this file. The network
  # component recorded this as an obligation it could not enforce: a publicly
  # accessible instance in a private subnet still receives a public endpoint, and
  # no security group rule prevents it. Routing provides no second barrier because
  # the database shares the private tier with the application.
  assert {
    condition     = aws_db_instance.main.publicly_accessible == false
    error_message = "The instance is publicly accessible. A public endpoint is assigned regardless of subnet placement, and no security group rule prevents reaching it (FR-004)."
  }

  # FR-005, SC-008. The network component's single ingress rule admits this port
  # and nothing else. A different port leaves the instance running and unreachable,
  # with no error raised by either component.
  assert {
    condition     = aws_db_instance.main.port == 5432
    error_message = "The instance does not listen on 5432, the only port the network component's ingress rule admits (FR-005)."
  }

  # FR-023.
  assert {
    condition     = aws_db_instance.main.storage_encrypted == true
    error_message = "Storage is not encrypted at rest (FR-023). The database will hold worker names, site assignments, and acknowledgements."
  }

  # FR-023's second half — that encryption uses the DEFAULT managed key and no
  # customer-managed key exists — is deliberately NOT asserted here. kms_key_id is
  # computed when unset, so a mocked provider fabricates it and any assertion over
  # it would be checking invented data (research.md R-004). The categorical check
  # belongs to the source guard, which forbids aws_kms_key outright, and the plan
  # review confirms the resolved key.
}

run "instance_sits_only_in_the_private_subnets" {
  command = apply

  # FR-002, FR-007, SC-007. Consumed from the network component's published
  # contract, never re-declared, so a change there reaches this component instead
  # of leaving a stale copy behind.
  assert {
    condition = toset(aws_db_subnet_group.main.subnet_ids) == toset(
      data.terraform_remote_state.network.outputs.private_subnet_ids
    )
    error_message = "The subnet group does not contain exactly the network component's private subnets (FR-002, FR-007)."
  }

  # A public subnet inside the group would place the instance in the internet-
  # facing tier. Asserted separately from the equality above so the failure names
  # the actual danger rather than a set mismatch.
  assert {
    condition = length(setintersection(
      toset(aws_db_subnet_group.main.subnet_ids),
      toset(data.terraform_remote_state.network.outputs.public_subnet_ids)
    )) == 0
    error_message = "The subnet group contains a public subnet. The instance must sit only in the private tier (FR-002)."
  }

  # FR-002, FR-003, SC-007. Exactly one group, and it is the one the network
  # component created with a single 5432 ingress rule and no egress. This
  # component declares no group of its own — the source guard enforces that
  # categorically, since a terraform test assertion cannot see a resource type
  # that is absent.
  assert {
    condition = aws_db_instance.main.vpc_security_group_ids == toset([
      data.terraform_remote_state.network.outputs.database_security_group_id
    ])
    error_message = "The instance is not attached to exactly the network component's database security group (FR-002, FR-003)."
  }
}

run "server_refuses_unencrypted_connections_and_logs_no_statements" {
  command = apply

  # FR-006, SC-009. rds.force_ssl makes the SERVER refuse an unencrypted
  # connection. A client-side sslmode alone is a request the server may ignore,
  # which is the difference between requiring encryption and offering it.
  assert {
    condition = length([
      for p in aws_db_parameter_group.main.parameter :
      p if p.name == "rds.force_ssl" && p.value == "1"
    ]) == 1
    error_message = "The parameter group does not require encrypted transport. Without rds.force_ssl a client that omits encryption connects in clear text (FR-006)."
  }

  # FR-039, SC-021. The safe state is the PostgreSQL default, so this is an
  # ABSENCE to protect rather than a setting to add. The realistic failure is
  # someone adding log_statement = "all" to debug something and not removing it —
  # invisible to any assertion that only checks what IS configured.
  assert {
    condition = length([
      for p in aws_db_parameter_group.main.parameter :
      p if contains(["log_statement", "log_min_duration_statement"], p.name)
    ]) == 0
    error_message = "A statement-logging parameter is configured. Statement text captures query parameters over worker records, placing personal data in a log outside the database's own access controls (FR-039)."
  }
}

run "engine_log_is_exported_under_a_declared_retention" {
  command = apply

  # FR-037. The two failure modes this component introduces — a connection refused
  # for lacking encrypted transport, and an authentication failure after a rotation
  # the service performs unannounced — are invisible in default service metrics and
  # visible here.
  assert {
    condition     = contains(aws_db_instance.main.enabled_cloudwatch_logs_exports, "postgresql")
    error_message = "The engine log is not exported. A refused connection and a post-rotation authentication failure are otherwise observable only as a failed health check (FR-037)."
  }

  # FR-038. The service creates this group implicitly on first export with NO
  # expiry, so logs would accumulate and bill indefinitely. Declaring the group is
  # the only way to own its retention.
  assert {
    condition     = aws_cloudwatch_log_group.postgresql.retention_in_days > 0
    error_message = "The log group has no explicit retention. An implicitly created group never expires (FR-038)."
  }
}

# FR-030, SC-015. The account precondition must still bite. Every other run pins
# the caller identity to the expected account; this one varies the expectation
# against that fixed identity to prove the guard is real rather than vacuous.
run "rejects_mismatched_account" {
  # Plan, not apply: a lifecycle precondition is evaluated during planning, which
  # is the point — the dispatch fails before any resource is created.
  command = plan

  variables {
    expected_account_id = "210987654321"
  }

  expect_failures = [aws_db_instance.main]
}

# ---------------------------------------------------------------------------
# Credential ownership (US2)
#
# The categorical guarantees — no password argument, no random generator, no
# secret container, no variable that could carry a credential — belong to the
# source guard, because a terraform test assertion cannot see what is absent.
# What IS assertable here is the positive: the service owns the credential, and
# this component holds only its identifier.
# ---------------------------------------------------------------------------

run "managed_service_owns_the_master_credential" {
  command = apply

  # FR-010. With this set, the service generates the password, stores it in a
  # secret it names under the reserved rds! prefix, and rotates it natively.
  # Terraform receives back an identifier and never a value — which is what makes
  # SCRUM-174's FR-005 hold downstream as well as at its origin.
  assert {
    condition     = aws_db_instance.main.manage_master_user_password == true
    error_message = "The instance does not use the service's managed master password. Any other arrangement puts a credential Terraform can see into plaintext state (FR-010)."
  }

  # FR-013 — the service names the secret; this component learns only the
  # identifier. Asserting it is non-empty confirms the wiring exists for the
  # narrowing grant in US4 to pin against.
  assert {
    condition     = length(aws_db_instance.main.master_user_secret) == 1
    error_message = "No service-managed credential identifier is available. The narrowing grant (FR-018) has nothing to pin to."
  }

  # FR-008 — one definition of the username, read back from the secrets component
  # rather than restated here, so the two cannot drift apart.
  assert {
    condition     = aws_db_instance.main.username == data.aws_ssm_parameter.database_username.value
    error_message = "The master username does not match the value the secrets component publishes (FR-008)."
  }
}

# ---------------------------------------------------------------------------
# Connection wiring (US3)
# ---------------------------------------------------------------------------

run "connection_url_lives_where_the_execution_identity_can_read_it" {
  command = apply

  # FR-016, SC-010 — SCRUM-174 obligation 6. The task execution identity's
  # parameter read grant is scoped to this prefix. An entry created anywhere else
  # is unreadable, and the application fails to start with an authorization error
  # that looks like a permissions bug rather than a naming one.
  assert {
    condition = startswith(
      aws_ssm_parameter.db_url.name,
      "${data.terraform_remote_state.secrets.outputs.config_parameter_prefix}/"
    )
    error_message = "The connection URL entry is outside the prefix the secrets component publishes. The execution identity's read grant does not cover it (FR-016)."
  }

  assert {
    condition     = endswith(aws_ssm_parameter.db_url.name, "/db/url")
    error_message = "The connection URL entry is not named db/url, which is the name the compute component expects (FR-016)."
  }

  # FR-017 — plain String, not SecureString. A JDBC URL carries host, port, and
  # database name; the password is a separate property. Encrypting a non-secret
  # would obscure which entries are actually sensitive, and a SecureString holds
  # its value in state.
  assert {
    condition     = aws_ssm_parameter.db_url.type == "String"
    error_message = "The connection URL is stored as an encrypted parameter. It is configuration, not a credential, and SecureString holds its value in state (FR-017)."
  }
}

run "connection_url_is_derived_and_carries_no_credential" {
  command = apply

  # FR-040, SC-022 — the derivation assertion. The sentinel comes from the
  # override_resource block above. A hard-coded endpoint would not contain it,
  # which is what makes this assertion distinguish the two implementations rather
  # than merely restate the configuration (research.md R-004).
  #
  # This matters because a restore produces a NEW endpoint: a literal would
  # survive the restore while silently addressing the dead instance, with every
  # resource looking correct in isolation.
  assert {
    condition     = strcontains(aws_ssm_parameter.db_url.value, "db-sentinel")
    error_message = "The connection URL does not track the instance's address. A literal endpoint would survive a restore while addressing the instance that no longer exists (FR-040)."
  }

  # FR-005, FR-017 — the only port the network component's ingress rule admits.
  assert {
    condition     = strcontains(aws_ssm_parameter.db_url.value, ":5432/")
    error_message = "The connection URL does not address port 5432 (FR-005, FR-017)."
  }

  assert {
    condition     = strcontains(aws_ssm_parameter.db_url.value, "/crewsafe?")
    error_message = "The connection URL does not name the initial database (FR-017)."
  }

  # FR-006, FR-017 — the client asks for encryption to match the server that
  # requires it. Without this a client could attempt a clear-text connection and
  # be refused, which presents as a confusing connectivity failure rather than a
  # configuration one.
  assert {
    condition     = strcontains(aws_ssm_parameter.db_url.value, "sslmode=require")
    error_message = "The connection URL does not request encrypted transport, while the server requires it (FR-006, FR-017)."
  }

  # FR-017, SC-011 — no credential, by any spelling. A JDBC URL can legally carry
  # user and password as query parameters, which is precisely the mistake this
  # asserts against.
  assert {
    condition = alltrue([
      for fragment in ["password", "user=", "username="] :
      !strcontains(lower(aws_ssm_parameter.db_url.value), fragment)
    ])
    error_message = "The connection URL contains a credential or a username. It is published as plain configuration and readable by anyone who can read the parameter (FR-017)."
  }
}

# ---------------------------------------------------------------------------
# Producer contract and the narrowing grant (US4)
#
# The policy is decoded from the document actually attached to the role, not from
# a local. That is stricter: it is what would really be sent to AWS. It works
# under a mocked provider only because the policy is a jsonencode() of
# configuration rather than a rendered data "aws_iam_policy_document", whose json
# attribute the mock would fabricate — every assertion would then be checking
# invented data and passing meaninglessly (research.md R-004, and the same
# decision the secrets component made).
# ---------------------------------------------------------------------------

run "narrowing_grant_is_exactly_one_pinned_read" {
  command = apply

  # FR-018, SC-012. SCRUM-174 granted read on the service-reserved rds! PREFIX
  # because the credential did not exist yet, and published
  # task_execution_role_name for exactly one reason: so this component could
  # narrow it once the real identifier existed. It now does.
  assert {
    condition     = length(jsondecode(aws_iam_role_policy.pinned_credential_read.policy).Statement) == 1
    error_message = "The narrowing grant holds more than one statement. Narrowing one grant must not be the occasion for introducing another (FR-018)."
  }

  assert {
    condition = jsondecode(aws_iam_role_policy.pinned_credential_read.policy).Statement[0].Action == [
      "secretsmanager:GetSecretValue"
    ]
    error_message = "The narrowing grant holds an action other than the single credential read it exists for (FR-018)."
  }

  # SC-012 — exactly one resource, and no wildcard. A wildcard here would widen
  # the very grant this component exists to narrow.
  assert {
    condition     = length(jsondecode(aws_iam_role_policy.pinned_credential_read.policy).Statement[0].Resource) == 1
    error_message = "The narrowing grant names more or fewer than one resource (FR-018)."
  }

  assert {
    condition = !strcontains(
      jsondecode(aws_iam_role_policy.pinned_credential_read.policy).Statement[0].Resource[0], "*"
    )
    error_message = "The narrowing grant uses a wildcard. Its entire purpose is to replace SCRUM-174's prefix grant with an exact identifier (FR-018, SC-012)."
  }
}

run "narrowing_grant_is_derived_and_attached_to_the_published_role" {
  command = apply

  # FR-040, SC-022 — derived from the instance, like the connection URL. A
  # restore produces a new service-managed credential; a literal ARN would keep
  # pointing at the old one.
  assert {
    condition = jsondecode(aws_iam_role_policy.pinned_credential_read.policy).Statement[0].Resource[0] == (
      aws_db_instance.main.master_user_secret[0].secret_arn
    )
    error_message = "The narrowing grant's resource is not derived from the instance's service-managed credential. A literal ARN would survive a restore while addressing the credential that no longer exists (FR-040)."
  }

  # FR-018 — attached to the role the secrets component published, which is the
  # whole reason that output exists.
  assert {
    condition     = aws_iam_role_policy.pinned_credential_read.role == data.terraform_remote_state.secrets.outputs.task_execution_role_name
    error_message = "The narrowing grant is not attached to the execution role the secrets component published (FR-018)."
  }

  # R-010 — two components now write inline policies onto this one role. Inline
  # policy attachment is an upsert, so a shared name would silently delete the
  # other component's grant. The names must differ, and this asserts the
  # distinguishing prefix is present rather than trusting it.
  assert {
    condition     = startswith(aws_iam_role_policy.pinned_credential_read.name, "crewsafe-shared-dev-db-")
    error_message = "The narrowing policy's name does not carry this component's distinguishing prefix. Inline policy attachment is an upsert: a name collision silently replaces the secrets component's own policy (R-010)."
  }
}

run "published_contract_carries_identifiers_and_no_values" {
  command = apply

  # FR-031, SC-019 — the compute component binds to these names and to nothing
  # else. Every one is a host, a port, a name, or an ARN.
  assert {
    condition     = output.db_instance_port == 5432
    error_message = "The published port is not 5432 (FR-005, FR-031)."
  }

  assert {
    condition     = output.db_name == "crewsafe"
    error_message = "The published database name does not match the one the instance creates (FR-031)."
  }

  assert {
    condition     = strcontains(output.master_user_secret_arn, "secret:rds!")
    error_message = "The published credential identifier is not the service-managed secret. The service names it under the reserved rds! prefix (FR-013, FR-031)."
  }

  assert {
    condition     = output.db_url_parameter_name == aws_ssm_parameter.db_url.name
    error_message = "The published parameter name does not match the entry this component creates (FR-031)."
  }

  # FR-015 — the contract publishes identifiers, never values. A password
  # appearing in any output would defeat every control in this component from the
  # outside.
  assert {
    condition = alltrue([
      for value in [
        output.db_instance_address,
        output.db_name,
        output.master_user_secret_arn,
        output.db_url_parameter_name,
        output.db_subnet_group_name,
      ] : !strcontains(lower(value), "password")
    ])
    error_message = "A published output contains a credential. Every output is an identifier, a name, a host, or a port (FR-015, FR-031)."
  }
}

# ---------------------------------------------------------------------------
# Durability and lifecycle (US5)
#
# Every backend lane depends on this instance. Losing its data blocks all of them
# at once, which is why the refusals are doubled: the catalogue guard refuses a
# destroy dispatch, and deletion protection refuses it again at the service.
# ---------------------------------------------------------------------------

run "deletion_is_refused_and_backups_are_retained" {
  command = apply

  # FR-025, SC-013 — the second of two independent refusals. The first is
  # allow_destroy: false in the component catalogue, asserted by
  # test-component-catalog.sh.
  assert {
    condition     = aws_db_instance.main.deletion_protection == true
    error_message = "Deletion protection is disabled. It is the refusal that still holds even if the catalogue guard were bypassed (FR-025)."
  }

  # FR-024 — seven days is the floor. Below it, REL-003's recovery window is
  # shorter than the time it typically takes to notice data loss in a shared
  # development environment.
  assert {
    condition     = aws_db_instance.main.backup_retention_period >= 7
    error_message = "Automated backups are retained for fewer than seven days, which does not satisfy FR-024's recovery window."
  }

  # FR-025 — a final snapshot on deletion. Skipping it makes an accidental
  # deletion unrecoverable even when the operator meant to keep the data.
  assert {
    condition     = aws_db_instance.main.skip_final_snapshot == false
    error_message = "Final snapshot skipping is configured. Deletion would then be unrecoverable (FR-025)."
  }

  assert {
    condition     = aws_db_instance.main.final_snapshot_identifier != null && aws_db_instance.main.final_snapshot_identifier != ""
    error_message = "No final snapshot identifier is set, so skip_final_snapshot = false cannot be honoured (FR-025)."
  }

  # FR-024, REL-006 — the backup window must not overlap the maintenance window;
  # RDS rejects an overlap mid-apply, which turns a settled decision into a failed
  # run. Both are outside the working day in the project's timezone.
  assert {
    condition     = aws_db_instance.main.backup_window != "" && aws_db_instance.main.maintenance_window != ""
    error_message = "A backup or maintenance window is unset, leaving the service to assign one that could fall inside the working day (FR-024, REL-006)."
  }
}

run "storage_grows_automatically_but_within_a_ceiling" {
  command = apply

  # FR-036, SC-023, US5 scenario 9. Both halves matter: growth without an apply so
  # a full disk is not an outage, and a finite ceiling so a runaway migration or
  # seeding defect stops somewhere a human must consciously raise rather than
  # billing indefinitely.
  assert {
    condition     = aws_db_instance.main.max_allocated_storage > aws_db_instance.main.allocated_storage
    error_message = "Automatic storage growth is disabled or unbounded. Both defeat FR-036 — one turns a full disk into an outage, the other removes the only refusal point a runaway consumer meets."
  }
}

run "minor_upgrades_apply_automatically_without_producing_drift" {
  command = apply

  # FR-041, SC-024, US5 scenario 11. REL-006 already accepted brief unavailability
  # in a window outside the working day; automatic minor upgrades are the routine
  # consumer of that allowance, and they are how security patches actually land.
  assert {
    condition     = aws_db_instance.main.auto_minor_version_upgrade == true
    error_message = "Automatic minor version upgrades are disabled, making patching depend on someone remembering. An unpatched staging database is a real finding (FR-041)."
  }

  # FR-041, SC-025, US5 scenario 12, research.md R-008. This is the mechanism
  # behind "no perpetual diff": supplying the MAJOR version alone lets the service
  # run any minor within it, so an automatic upgrade produces no plan change. A
  # pinned minor would make every subsequent plan propose reverting the upgrade —
  # diff noise that trains reviewers to skim, which is worse than the drift it
  # reports. Note this was achieved WITHOUT ignore_changes, which the source guard
  # forbids for exactly that reason.
  assert {
    condition     = !strcontains(aws_db_instance.main.engine_version, ".")
    error_message = "The engine version is pinned to a minor release. Every plan after an automatic upgrade would propose reverting it (FR-041, R-008)."
  }

  # FR-001 — the pin that actually matters. Major versions change migration
  # behaviour; the service must never raise one unattended.
  assert {
    condition     = aws_db_instance.main.allow_major_version_upgrade == false || aws_db_instance.main.allow_major_version_upgrade == null
    error_message = "Major version upgrades are permitted. A major version changes migration behaviour and is its own reviewed decision (FR-001)."
  }
}
