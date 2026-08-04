#!/usr/bin/env bash
# Source guard for the database-shared-dev component (SCRUM-175).
#
# This exists because `terraform test` structurally cannot express "no resource of
# this type is declared anywhere in this directory" — its assertions run over the
# resources a configuration DOES declare, so a forbidden resource type is invisible
# to it precisely when someone has added one. Grep is the right tool for a
# categorical absence; `terraform test` is the right tool for attribute content.
#
# What is being protected, in order of how badly it would hurt:
#
#   1. The database master credential must never enter Terraform state. State is
#      plaintext in S3 and readable by anyone with s3:GetObject on the bucket, and
#      a leaked state file is not a leak that can be retracted. The managed
#      service generates, stores, and rotates the credential; no component holds
#      it. SCRUM-174 named a `password =` here as "the likeliest way this design
#      is undone, because setting a password explicitly is the more obvious thing
#      to write" — which is exactly why it is checked mechanically.
#   2. The network component owns the database security group and created it with
#      one ingress rule and no egress. A second group declared here would be a
#      second inbound control surface that SCRUM-173's negative test does not
#      inspect.
#   3. The engine log must not carry statement text. The database will hold worker
#      names, site assignments, and acknowledgements; a statement log would place
#      those query parameters outside the database's own access controls.
set -euo pipefail
source "$(dirname "$0")/helpers/test-helpers.sh"

component_dir="infra/terraform/database"
tf_files=("$ROOT/$component_dir"/*.tf)

[[ -e "${tf_files[0]}" ]] || fail "$component_dir contains no .tf files to scan"

# Strip comments before scanning so the explanatory prose in main.tf and
# variables.tf — which names several of these constructs in order to say why they
# are absent — does not trip the guard it is describing.
scan() {
  sed -E 's/#.*$//; s|//.*$||' "${tf_files[@]}"
}

forbid() {
  local pattern="$1" label="$2" reason="$3"
  # `< <(scan)`, not `scan | grep -Eq`. With `set -o pipefail`, grep -q's early exit
  # on the first match can SIGPIPE sed before it finishes writing scan()'s output;
  # pipefail then reports the SIGPIPE death (141) instead of grep's match (0), and
  # this `if` silently takes the wrong branch. Found and fixed in the compute
  # component's identical guard while debugging SCRUM-176 — see that file's forbid()
  # for the reproduction. Process substitution's exit status is not part of this
  # command's pipeline, so pipefail cannot poison it.
  if grep -Eq -- "$pattern" < <(scan); then
    fail "$component_dir declares $label. $reason"
  fi
}

# --- Constructs that would place a credential value in Terraform state ---------

# FR-010, FR-011. Anchored to a line-leading assignment so it catches a real
# argument without matching master_user_secret, password_length, or a comment.
# A false positive here would make the guard unusable and invite someone to
# loosen it, so the anchoring is deliberate and is exercised by a decoy in
# main.tf.
forbid '^[[:space:]]*password[[:space:]]*=' \
  'a literal password argument' \
  'The managed service owns the master credential (FR-010). Any password Terraform can see is a password in plaintext state.'

forbid '(^|[^a-z_])resource[[:space:]]+"random_(password|string|id|bytes)"' \
  'a random value generator' \
  'A generated credential is stored in state in plaintext (FR-011). Let the managed service generate it.'

forbid '(^|[^a-z_])resource[[:space:]]+"aws_secretsmanager_secret(_version)?"' \
  'a Secrets Manager secret' \
  'The managed database service creates and names the master credential (FR-013). This component learns only its identifier.'

forbid '(^|[^a-z_])data[[:space:]]+"aws_secretsmanager_secret_version"' \
  'a data source reading a secret value' \
  'Reading a credential into state is as damaging as writing one (FR-011).'

forbid 'with_decryption[[:space:]]*=[[:space:]]*true' \
  'a decrypting parameter read' \
  'Decrypting a SecureString pulls its value into state (FR-011).'

forbid 'type[[:space:]]*=[[:space:]]*"SecureString"' \
  'an aws_ssm_parameter of type SecureString' \
  'Encrypted parameters hold their value in state, and the connection URL is not a credential (FR-017).'

forbid '(^|[^a-z_])resource[[:space:]]+"aws_kms_key"' \
  'a customer-managed encryption key' \
  'Storage uses the default managed key (FR-023) so authorization stays in the IAM policies the tests inspect, not split with a key policy they do not.'

# --- Constructs that would create a second inbound control surface -------------

forbid '(^|[^a-z_])resource[[:space:]]+"aws_(default_)?security_group"' \
  'a security group' \
  'The network component owns the database security group (FR-003). A second one is an inbound control surface its negative test does not inspect.'

forbid '(^|[^a-z_])resource[[:space:]]+"aws_(vpc_)?security_group_(ingress|egress)_rule"' \
  'a security group rule' \
  'The network component declared the only ingress rule, admitting 5432 from the application group (FR-003).'

forbid 'publicly_accessible[[:space:]]*=[[:space:]]*true' \
  'a publicly accessible instance' \
  'A publicly accessible instance in a private subnet still receives a public endpoint, and no security group rule prevents it (FR-004).'

# --- Constructs that would place personal data in an operational log ----------

forbid 'name[[:space:]]*=[[:space:]]*"log_(statement|min_duration_statement)"' \
  'a statement-logging parameter' \
  'Statement text would capture query parameters over worker records, placing personal data in a log outside the database access controls (FR-039). The PostgreSQL default is already correct; leave it alone.'

# --- Constructs that would author the schema from outside the migration set ----

# FR-020, FR-022. The application's Flyway migrations are the schema's only
# author. Terraform provisions the instance and stops there.
forbid '(^|[^a-z_])provisioner[[:space:]]+"' \
  'a provisioner' \
  'No SQL may be executed against the instance from Terraform (FR-022). The migration set in the application source is the schema only author.'

forbid '(^|[^a-z_])resource[[:space:]]+"(null_resource|terraform_data)"' \
  'an escape-hatch execution resource' \
  'These exist to run commands, which is how SQL execution creeps in (FR-022).'

forbid '(^|[^a-z_])resource[[:space:]]+"aws_(ecs_task_definition|ecs_service|ecs_cluster|codebuild_project|ecr_repository)"' \
  'migration or compute infrastructure' \
  'Migrations run in-process at application startup; the deploy path belongs to SCRUM-176 (FR-020). This component builds no runner.'

# --- Entries owned by another component ---------------------------------------

forbid 'cors/allowed-origins' \
  'the cross-origin configuration entry' \
  'Its value is the web application public origin, which does not exist yet. It is owned by whatever component creates that origin (FR-019).'

# --- Constructs that would hide genuine drift ---------------------------------

# FR-011 and R-008. Suppressing changes on a value-bearing attribute holds a stale
# value in state and hides drift nobody intended. The engine version needed no
# suppression: supplying the major version alone lets an automatic minor upgrade
# produce no diff at all.
if scan | tr '\n' ' ' | grep -Eq 'ignore_changes[[:space:]]*=[[:space:]]*\[[^]]*(engine_version|password|value)'; then
  fail "$component_dir suppresses changes to a value-bearing attribute. Supply the major engine version alone instead of pinning a minor and ignoring it (R-008)."
fi

# --- Positive structural checks ----------------------------------------------

assert_file "$component_dir/versions.tf"
assert_file "$component_dir/backend.tf"
assert_file "$component_dir/.terraform.lock.hcl"
assert_file "$component_dir/iam/plan-role-policy.json"
assert_file "$component_dir/iam/apply-role-policy.json"

# No variable may carry a password (FR-012). Because no such variable exists, a
# committed tfvars file could not supply a credential even by mistake.
if grep -Eq '^[[:space:]]*variable[[:space:]]+"[a-z_]*password[a-z_]*"' "$ROOT/$component_dir/variables.tf"; then
  fail "$component_dir declares a variable that could carry a password. FR-012 forbids one so that no value file can supply a credential."
fi

# Neither CI role may read a secret value. This is a second, independent guarantee
# behind FR-011: even if every check above were wrong, a plan cannot render a
# credential it has no permission to fetch. Nor may either read log content — CI
# writes the log container, never its contents (FR-033).
for policy in plan apply; do
  document="$ROOT/$component_dir/iam/${policy}-role-policy.json"
  if grep -Fq 'secretsmanager:GetSecretValue' "$document"; then
    fail "$component_dir/iam/${policy}-role-policy.json grants secretsmanager:GetSecretValue. The CI roles provision the instance; they must never read the credential the service manages (FR-033)."
  fi
  if grep -Eq 'logs:(GetLogEvents|FilterLogEvents)' "$document"; then
    fail "$component_dir/iam/${policy}-role-policy.json grants log read access. CI manages the log container and its retention, never its contents (FR-033)."
  fi
done

printf 'PASS: %s declares no construct capable of placing a credential value in Terraform state, creating a second inbound control surface, authoring the schema, or logging personal data.\n' "$component_dir"
