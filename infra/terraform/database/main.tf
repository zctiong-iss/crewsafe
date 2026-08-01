data "aws_caller_identity" "current" {}

# The network component publishes the private subnets this instance sits in and
# the security group that admits it. Reading them here rather than re-declaring
# them means a change there cannot leave a stale copy behind (FR-002).
#
# The bucket name is derived, not configured: the convention lives in
# .github/scripts/terraform/resolve-terraform-account.sh:62 and is mirrored here,
# the same duplication the secrets component accepted (research.md R-001). A
# divergence fails loudly at init rather than silently producing wrong values.
# The plan role already holds s3:GetObject on crewsafe/*, so no IAM change is
# required to read either state.
data "terraform_remote_state" "network" {
  backend = "s3"
  config = {
    bucket = "crewsafe-terraform-state-${var.expected_account_id}-${var.aws_region}"
    key    = "crewsafe/network/shared-dev.tfstate"
    region = var.aws_region
  }
}

# The secrets component publishes the configuration prefix this component writes
# the connection URL under, and the name of the execution role whose credential
# grant this component narrows (FR-016, FR-018).
data "terraform_remote_state" "secrets" {
  backend = "s3"
  config = {
    bucket = "crewsafe-terraform-state-${var.expected_account_id}-${var.aws_region}"
    key    = "crewsafe/secrets/shared-dev.tfstate"
    region = var.aws_region
  }
}

# FR-008 — the master user's name has exactly one definition, and it lives in the
# secrets component. Reading it back rather than re-declaring a matching default
# is what makes "matches the value the secrets component publishes" true by
# construction instead of by coincidence of two defaults drifting apart.
#
# with_decryption is explicitly false. This entry is a plain String by the secrets
# component's classification rule — a username is not a credential — and pinning
# the flag off means this data source can never be repurposed into a secret read
# (FR-011). The plan role already holds ssm:GetParameter, so no IAM change is
# needed.
data "aws_ssm_parameter" "database_username" {
  name            = "${local.config_parameter_prefix}/db/username"
  with_decryption = false
}

locals {
  name_prefix = "crewsafe-shared-dev"

  network = data.terraform_remote_state.network.outputs
  secrets = data.terraform_remote_state.secrets.outputs

  # SCRUM-174 obligation 6. The task execution identity's parameter read grant is
  # scoped to this prefix, so an entry created anywhere else is unreadable and the
  # application fails to start with an authorization error that looks like a
  # permissions bug rather than a naming one. Consumed, never transcribed.
  config_parameter_prefix = local.secrets.config_parameter_prefix

  # The database this component creates and the user the application connects as.
  # Both match local/compose.yaml so the deployed and local environments do not
  # diverge gratuitously (FR-008). The username is read from the secrets
  # component rather than restated; the database name is fixed here because
  # making it configurable would only invite staging and local to diverge.
  db_name     = "crewsafe"
  db_username = data.aws_ssm_parameter.database_username.value

  # SCRUM-173 obligation 2. The network component's single ingress rule admits
  # this port and no other; an instance listening elsewhere would be running and
  # unreachable, with no error at either component (FR-005).
  db_port = 5432
}

# ---------------------------------------------------------------------------
# Placement
#
# Two private subnets across two availability zones, consumed from the network
# component (FR-002, FR-007). This satisfies the service's two-zone minimum and
# leaves room for a standby later without re-placing the instance — FR-009 defers
# that standby, it does not preclude it.
#
# There is deliberately NO security group and no security group rule anywhere in
# this component (FR-003). SCRUM-173 already created the database group with
# exactly one ingress rule — 5432/TCP from the application group — and no egress
# rule at all. A second group declared here would be a second inbound control
# surface, and SCRUM-173's negative test, the one demonstrated catching a widened
# rule, inspects only its own. The source guard enforces the absence, because a
# terraform test assertion cannot see a resource type that is not there.
# ---------------------------------------------------------------------------

resource "aws_db_subnet_group" "main" {
  name        = "${local.name_prefix}-db"
  description = "Private subnets across two availability zones for the shared development database. Consumed from the network component; never re-declared here."
  subnet_ids  = local.network.private_subnet_ids
}

# ---------------------------------------------------------------------------
# Engine settings
#
# Exactly one parameter is declared, and the absences matter as much as the
# presence.
#
# rds.force_ssl makes the SERVER refuse an unencrypted connection rather than
# merely offering encryption. A client-side sslmode is a request the server may
# ignore; this is the control that makes FR-006 a requirement rather than a
# suggestion. A custom group exists solely because the default group cannot be
# modified.
#
# log_statement and log_min_duration_statement are deliberately NOT declared, so
# both keep the PostgreSQL defaults ("none" and -1). FR-039 forbids statement
# logging: this database will hold worker names, site assignments, and
# acknowledgements, and a statement log would capture those query parameters into
# a log outside the database's own access controls. The safe state is the
# default, so the test asserts these names are ABSENT — the realistic failure is
# someone adding log_statement = "all" to debug something and forgetting to
# remove it, which no assertion over configured values would catch.
# ---------------------------------------------------------------------------

resource "aws_db_parameter_group" "main" {
  name        = "${local.name_prefix}-pg${var.engine_major_version}"
  family      = "postgres${var.engine_major_version}"
  description = "Requires encrypted transport for the shared development database. Declares no statement logging, deliberately."

  parameter {
    name  = "rds.force_ssl"
    value = "1"
    # Dynamic, so enabling it does not force an instance reboot. Verify in the
    # plan output that this shows apply_method "immediate" rather than
    # "pending-reboot" (research.md R-005); a static parameter would need an
    # explicit reboot step in the runbook.
    apply_method = "immediate"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# ---------------------------------------------------------------------------
# Engine log
#
# Declared BEFORE the instance, and the instance depends on it — an inversion of
# the intuitive order that is load-bearing (research.md R-007).
#
# The service creates this log group implicitly on first export, with NO expiry,
# so logs would accumulate and bill indefinitely. Declaring it is the only way to
# own the retention FR-038 requires. But if the instance is created first, the
# service wins the race and Terraform's later attempt fails with
# ResourceAlreadyExistsException rather than adopting the group. Hence depends_on
# below.
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "postgresql" {
  name              = "/aws/rds/instance/${local.name_prefix}/postgresql"
  retention_in_days = 7
}

# ---------------------------------------------------------------------------
# The instance
#
# There is no `password` argument here, and there never may be.
#
# That absence is the mechanism behind FR-010 and FR-011 — not a `sensitive`
# marking, which only suppresses console rendering while the value sits in
# plaintext in the state object in S3, readable by anyone with s3:GetObject on
# the bucket. A leaked state file is not a leak that can be retracted.
#
# manage_master_user_password hands ownership to the service: it generates the
# password, stores it in a secret it names under the reserved rds! prefix, and
# rotates it natively. Terraform receives back only master_user_secret — an
# identifier, no value. SCRUM-174 anticipated exactly this and wrote its rds!*
# prefix grant for it, and named a literal password here as "the likeliest way
# this design is undone, because setting a password explicitly is the more
# obvious thing to write". That is why the source guard checks for it rather than
# trusting a reviewer to notice.
# ---------------------------------------------------------------------------

resource "aws_db_instance" "main" {
  identifier = local.name_prefix

  engine = "postgres"
  # Major version only. A pinned minor would make every plan after an automatic
  # minor upgrade propose reverting it — perpetual diff noise that trains
  # reviewers to skim, which is worse than the drift it reports (R-008). The
  # major version is what governs migration behaviour, and
  # allow_major_version_upgrade stays at its default false.
  engine_version = var.engine_major_version
  instance_class = var.instance_class

  db_name  = local.db_name
  port     = local.db_port
  username = local.db_username

  # FR-010 — the service owns the credential end to end. No password argument
  # exists above, and none may be added.
  manage_master_user_password = true

  # SCRUM-173 obligation 1, and the reason FR-004 gets a dedicated assertion
  # rather than being treated as a default: a publicly accessible instance in a
  # private subnet still receives a public endpoint, and no security group rule
  # here prevents reaching it. Routing provides no second barrier, because the
  # database shares the private tier with the application runtime.
  publicly_accessible = false

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [local.network.database_security_group_id]
  parameter_group_name   = aws_db_parameter_group.main.name

  # FR-009 — no standby. Out of scope for a shared development environment with
  # no availability requirement in the plan's NFRs; enabling it later needs no
  # re-placement, because the subnet group already spans two zones.
  multi_az = false

  storage_type      = "gp3"
  allocated_storage = var.allocated_storage
  # FR-036 — growth without an apply, so a full disk is an operational event
  # rather than an outage, AND a finite ceiling, so a runaway migration or seeding
  # defect stops somewhere a human must consciously raise. At the ceiling writes
  # fail, deliberately: that is the only refusal point a runaway consumer meets,
  # and raising it is a reviewed plan after establishing why the data grew.
  max_allocated_storage = var.max_allocated_storage
  # FR-023 — the default AWS-managed key. No customer-managed key is created, so
  # authorization is expressed solely in the IAM policies the tests inspect and
  # cannot be widened in a key policy they do not.
  storage_encrypted = true

  # FR-041 — minor versions advance automatically inside the maintenance window.
  # REL-006 already accepts brief unavailability there, so this costs nothing that
  # is not already accepted, and it is how security patches actually land: pinning
  # the minor would make patching depend on someone remembering, and an unpatched
  # staging database is a real finding rather than a hypothetical one.
  #
  # The accepted consequence is that the running minor version can drift from what
  # any given plan showed, so the deployed version is discovered from the instance
  # rather than read from source. Supplying the major version alone (above) is what
  # keeps that drift from surfacing as a perpetual plan diff — no ignore_changes
  # needed, which the source guard forbids anyway (R-008).
  auto_minor_version_upgrade = true

  # FR-024, REL-006 — 02:00 and 03:00 Singapore time. Non-overlapping, because RDS
  # rejects an overlap mid-apply and turns a settled decision into a failed run.
  # The one scheduling obligation this places on the team: do not demonstrate
  # during the maintenance window.
  backup_retention_period = var.backup_retention_days
  backup_window           = "18:00-19:00"
  maintenance_window      = "Sun:19:00-Sun:20:00"

  # FR-025 — two independent refusals against losing the staging data every
  # backend lane depends on. The catalogue's allow_destroy: false refuses the
  # dispatch; this refuses the deletion at the service even if that guard were
  # bypassed. And if a deletion is ever genuinely intended, a final snapshot is
  # taken rather than skipped.
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.name_prefix}-final"

  copy_tags_to_snapshot = true

  # Changes land in the maintenance window rather than mid-day. A resize is a
  # routine plan-and-apply (PERF-004), and this keeps it from interrupting work.
  apply_immediately = false

  enabled_cloudwatch_logs_exports = ["postgresql"]

  # R-007 — inverted deliberately. Without this the service creates the log group
  # itself on first export and Terraform's later attempt fails with
  # ResourceAlreadyExistsException instead of adopting it. SCRUM-173's apply
  # failed midway and left exactly this class of half-created state.
  depends_on = [aws_cloudwatch_log_group.postgresql]

  lifecycle {
    precondition {
      condition     = data.aws_caller_identity.current.account_id == var.expected_account_id
      error_message = "Authenticated AWS account does not match the expected account for this dispatch."
    }
  }
}

# ---------------------------------------------------------------------------
# Connection wiring
#
# SCRUM-174 obligation 6: this entry is created under the prefix THAT component
# publishes, read from its outputs rather than transcribed (FR-016). The task
# execution identity's parameter read grant is scoped to that prefix, so an entry
# created anywhere else is unreadable — and the resulting startup failure presents
# as an authorization error rather than a naming one, which is a much harder thing
# to diagnose.
#
# The value is DERIVED from the instance, never a literal (FR-040). That is what
# makes a restore recoverable: restoring produces a new endpoint, and a plan and
# apply re-derive this entry onto it. A hard-coded host would survive the restore
# while silently addressing the instance that no longer exists, with every
# resource looking correct in isolation.
#
# Type String, not SecureString: a JDBC URL carries host, port, and database name.
# The password is a separate property the execution identity injects from the
# service-managed secret, so there is no credential here to encrypt (FR-017).
#
# sslmode=require encrypts but does not verify the server certificate.
# verify-full would, but needs the RDS CA bundle inside the container image — a
# build-time dependency on a rotating certificate, owned by the compute component
# — for an instance already unreachable from the internet. The gap is recorded in
# the plan rather than left unstated (research.md R-005).
#
# The cross-origin entry under this same prefix is deliberately NOT created here
# (FR-019). Its value is the web application's public origin, which still does not
# exist; it belongs to whatever component creates that origin.
# ---------------------------------------------------------------------------

resource "aws_ssm_parameter" "db_url" {
  name        = "${local.config_parameter_prefix}/db/url"
  type        = "String"
  value       = "jdbc:postgresql://${aws_db_instance.main.address}:${aws_db_instance.main.port}/${local.db_name}?sslmode=require"
  description = "JDBC connection URL for the shared development database. Written by Terraform, derived from the instance; read by the task execution role at task start. Not a credential - the password is held by the managed database service and injected separately."
}

# ---------------------------------------------------------------------------
# Narrowing the one compromise SCRUM-174 accepted
#
# That component granted secretsmanager:GetSecretValue on the service-reserved
# rds! PREFIX rather than a pinned ARN, because the service names the credential
# and it did not exist until this component did. It called that its single
# out-of-scope grant, bounded three ways, and published task_execution_role_name
# for exactly one reason: so this component could tighten it once the real
# identifier existed. It now does.
#
# Removing the prefix grant is a change to the SECRETS component's reviewed
# policy — obligation 8, a follow-up, not a drive-by edit from here. What this
# adds is the pinned path alongside it. Dropping this resource would leave that
# published output genuinely unused, which SCRUM-174 said explicitly would be a
# defect.
#
# Two things about the form:
#
#   - The policy is a jsonencode() of an HCL object, NOT a rendered
#     data "aws_iam_policy_document". Under mock_provider that data source's json
#     attribute is fabricated, so every assertion about policy content would be
#     checking invented data and passing meaninglessly (research.md R-004).
#   - It is inline rather than a managed policy with an attachment, following
#     SCRUM-174 FR-014: an inline policy cannot be attached to another principal
#     by accident and is deleted with its role.
#
# The name carries a component-specific prefix and that is load-bearing. Two
# components now write inline policies onto this one role, and attaching an
# inline policy is an UPSERT — a shared name would silently replace the secrets
# component's own grant, and the damage would surface later as an
# unrelated-looking AccessDenied on its next task start.
# ---------------------------------------------------------------------------

resource "aws_iam_role_policy" "pinned_credential_read" {
  name = "${local.name_prefix}-db-credential-read"
  role = local.secrets.task_execution_role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadThisDatabaseCredential"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [aws_db_instance.main.master_user_secret[0].secret_arn]
      },
    ]
  })
}
