#!/usr/bin/env bash
# Source guard for the secrets-shared-dev component (SCRUM-174).
#
# This exists because `terraform test` structurally cannot express "no resource of
# this type is declared anywhere in this directory" — its assertions run over the
# resources a configuration DOES declare, so a forbidden resource type is invisible
# to it precisely when someone has added one. Grep is the right tool for a
# categorical absence; `terraform test` is the right tool for policy content.
#
# What is being protected: this component provisions where credentials live. It
# must never hold a credential VALUE, because Terraform state is plaintext in S3
# and readable by anyone with s3:GetObject on the bucket. Marking an output
# `sensitive` does not help — it suppresses console rendering while the value sits
# in state regardless. The only durable guarantee is that no construct capable of
# putting a value there exists at all.
set -euo pipefail
source "$(dirname "$0")/helpers/test-helpers.sh"

component_dir="infra/terraform/secrets"
tf_files=("$ROOT/$component_dir"/*.tf)

[[ -e "${tf_files[0]}" ]] || fail "$component_dir contains no .tf files to scan"

# Strip comments before scanning so the explanatory prose in main.tf — which names
# several of these constructs in order to say why they are absent — does not trip
# the guard it is describing.
scan() {
  sed -E 's/#.*$//; s|//.*$||' "${tf_files[@]}"
}

forbid() {
  local pattern="$1" label="$2" reason="$3"
  if scan | grep -Eq -- "$pattern"; then
    fail "$component_dir declares $label. $reason"
  fi
}

# --- Constructs that would write a credential value into Terraform state -------

forbid '(^|[^a-z_])resource[[:space:]]+"aws_secretsmanager_secret_version"' \
  'aws_secretsmanager_secret_version' \
  'Terraform manages secret containers, never versions (FR-005). The value must be written out of band.'

forbid '(^|[^a-z_])resource[[:space:]]+"random_(password|string|id|bytes)"' \
  'a random value generator' \
  'A generated credential is stored in state in plaintext (FR-005). Let the managed service generate it.'

forbid 'type[[:space:]]*=[[:space:]]*"SecureString"' \
  'an aws_ssm_parameter of type SecureString' \
  'Encrypted parameters hold their value in state, and encrypting a non-secret obscures which values are actually sensitive (FR-003, FR-005).'

# --- Constructs that would read a credential value into Terraform state --------

forbid '(^|[^a-z_])data[[:space:]]+"aws_secretsmanager_secret_version"' \
  'a data source reading a secret version' \
  'Reading a value into state is as damaging as writing one (FR-005).'

forbid '(^|[^a-z_])data[[:space:]]+"aws_ssm_parameter"' \
  'a data source reading a parameter' \
  'Use the value this component already holds rather than reading it back (FR-005).'

# --- Constructs that would widen the authorization surface --------------------

forbid '(^|[^a-z_])resource[[:space:]]+"aws_kms_key"' \
  'a customer-managed KMS key' \
  'A key policy is a second place authorization can be widened, and one the IAM tests do not inspect (FR-030, SC-015).'

# Attaching AmazonECSTaskExecutionRolePolicy is the most likely future "fix" for a
# permissions problem, and it silently restores the account-wide image, log, and
# secret access that FR-012 exists to remove. Every permission here is written out
# by hand so it can be prefix-scoped and reviewed.
forbid '(^|[^a-z_])resource[[:space:]]+"aws_iam_role_policy_attachment"' \
  'a managed policy attachment' \
  'Platform permissions are granted explicitly and prefix-scoped, never by attaching a broad managed policy (FR-014).'

# --- Constructs that would hide drift on a value ------------------------------

# FR-031 forbids declaring a placeholder entry and suppressing changes to it: the
# stale value sits in state, and the suppression hides genuine drift on the same
# field, including drift nobody intended. An entry whose value a later component
# supplies is owned by that component.
if scan | tr '\n' ' ' | grep -Eq 'ignore_changes[[:space:]]*=[[:space:]]*\[[^]]*(value|secret_string)'; then
  fail "$component_dir suppresses changes to a value attribute. FR-031 forbids placeholder-with-suppression; the producing component owns the entry instead."
fi

# --- Positive structural checks ----------------------------------------------

assert_file "$component_dir/versions.tf"
assert_file "$component_dir/backend.tf"
assert_file "$component_dir/.terraform.lock.hcl"
assert_file "$component_dir/iam/plan-role-policy.json"
assert_file "$component_dir/iam/apply-role-policy.json"

# Neither CI role may read a secret value. This is a second, independent guarantee
# behind FR-005: even if every check above were wrong, a plan cannot render a
# credential it has no permission to fetch.
for policy in plan apply; do
  if grep -Fq 'secretsmanager:GetSecretValue' "$ROOT/$component_dir/iam/${policy}-role-policy.json"; then
    fail "$component_dir/iam/${policy}-role-policy.json grants secretsmanager:GetSecretValue. The CI roles create and describe containers; they must never read a value (FR-026)."
  fi
done

printf 'PASS: %s declares no construct capable of placing a credential value in Terraform state.\n' "$component_dir"
