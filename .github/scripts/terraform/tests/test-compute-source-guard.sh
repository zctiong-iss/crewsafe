#!/usr/bin/env bash
# Source guard for the compute-shared-dev component (SCRUM-176).
#
# This exists because `terraform test` structurally cannot express "no construct of
# this kind appears anywhere in this directory" — its assertions run over what a
# configuration DOES declare, so a forbidden construct is invisible to it precisely
# when someone has added one. Grep is the right tool for a categorical absence;
# `terraform test` is the right tool for attribute content. The two harnesses are
# complementary and the split follows the secrets and database components.
#
# What is being protected, in order of how badly it would hurt:
#
#   1. No credential may reach Terraform state, a task definition, or a log. State
#      is plaintext in S3 and a leaked state file is not a leak that can be
#      retracted. SCRUM-174 and SCRUM-175 each spent a whole specification keeping
#      the database credential out of every component; a plaintext environment
#      value in a task definition undoes both at once, and it is the likeliest way
#      this design is quietly broken because writing an environment variable is the
#      more obvious thing to do.
#   2. The load balancer must stay internal. An `internal = false` here would give
#      the origin a public address and make the distribution bypassable — the whole
#      reason a VPC origin was chosen over a prefix-list variant.
#   3. The application owns its schema transition. Flyway runs in-process before
#      traffic is accepted, with Hibernate pinned to `validate`. A task-definition
#      override, a second container, or a command override would re-open what
#      SCRUM-175's obligations 1 and 2 closed.
#   4. No shared origin-authentication secret may exist. The rejected
#      prefix-list-plus-header design needed one in state; forbidding it outright
#      stops it returning by accident when someone "hardens" the origin later.
set -euo pipefail
source "$(dirname "$0")/helpers/test-helpers.sh"

component_dir="infra/terraform/compute"
tf_files=("$ROOT/$component_dir"/*.tf)

[[ -e "${tf_files[0]}" ]] || fail "$component_dir contains no .tf files to scan"

# Strip comments before scanning so the explanatory prose — which names several of
# these constructs in order to say why they are absent — does not trip the guard it
# is describing.
scan() {
  sed -E 's/#.*$//; s|//.*$||' "${tf_files[@]}"
}

forbid() {
  local pattern="$1" label="$2" reason="$3"
  if scan | grep -Eq -- "$pattern"; then
    printf 'FAIL: %s declares %s.\n  %s\n' "$component_dir" "$label" "$reason" >&2
    scan | grep -En -- "$pattern" | head -5 >&2
    grep -En -- "$pattern" "${tf_files[@]}" | head -5 >&2
    exit 1
  fi
}

# --- Constructs that would place a credential in state or a task definition ----

# FR-027. Anchored to a line-leading assignment so it catches a real argument
# without matching master_user_secret_arn or a documented reference.
forbid '^[[:space:]]*password[[:space:]]*=' \
  'a literal password argument' \
  'Credentials are resolved by reference at task start (FR-027). Anything Terraform can see is plaintext in state.'

forbid '(^|[^a-z_])resource[[:space:]]+"random_(password|string|id|bytes)"' \
  'a random value generator' \
  'A generated credential or origin secret is still a credential in state (FR-027, FR-022a).'

# FR-027. A credential belongs in the container definition's `secrets` list, which
# the platform resolves at task start. The `environment` list is plaintext to
# anyone who can describe the task definition.
forbid '"(name|Name)"[[:space:]]*[:=][[:space:]]*"[A-Z_]*(PASSWORD|SECRET|TOKEN|CREDENTIAL)[A-Z_]*"[[:space:]]*,?[[:space:]]*$' \
  'an environment entry whose name reads like a credential' \
  'Credentials belong in the container definition secrets list, never its environment list (FR-027).'

# FR-028. A pinned version turns a routine rotation into an outage: the managed
# database service rotates the master credential on its own schedule. A correct
# reference ends with the JSON key and two EMPTY trailing fields, e.g.
# ":password::" — this catches a version id or stage in either position.
forbid ':(AWSCURRENT|AWSPENDING|AWSPREVIOUS)|:[0-9a-fA-F-]{36}:"|::[0-9a-fA-F-]{8,}"' \
  'a version-pinned secret reference' \
  'A pinned reference breaks when the managed service rotates the credential (FR-028). Leave the version id and stage empty.'

# FR-022a. The rejected origin-protection design fenced a public load balancer with
# a shared header. It required a secret in state, which SCRUM-174 and SCRUM-175
# forbid. The VPC origin makes the control structural instead.
forbid '[Xx]-[Oo]rigin-[Vv]erify|origin_secret|origin_shared_secret|custom_header' \
  'an origin-authentication header' \
  'The rejected prefix-list-plus-header design needed a secret in state (FR-022a). The VPC origin replaces it; the origin has no public address to fence.'

# --- Constructs that would move the schema boundary ----------------------------

# FR-035, FR-036, SC-020. The application runs Flyway in-process before accepting
# traffic and pins Hibernate to validate. These overrides would silently move the
# schema's owner.
forbid 'SPRING_FLYWAY|SPRING_JPA_HIBERNATE|DDL_AUTO|FLYWAY_' \
  'a migration or schema-validation override' \
  'The application owns its schema transition in-process (FR-035, FR-036). Disabling or loosening it makes a divergence invisible instead of failing fast at startup.'

# FR-037, FR-011. One process owns the schema transition, and it is the one that
# will serve the traffic. A second container or a command override is the other way
# migrations get run out of band.
forbid '"(essential|Essential)"[[:space:]]*[:=][[:space:]]*false' \
  'a non-essential sidecar container' \
  'The task definition declares exactly one container (FR-011). A sidecar is the usual shape of an out-of-band migration step (FR-037).'

forbid '"(command|Command|entryPoint|EntryPoint)"[[:space:]]*[:=]' \
  'a container command or entrypoint override' \
  'The image starts the application. An override is how a migration gets run separately from the process that serves traffic (FR-037).'

# A bind mount at /tmp reads as hardening and is the opposite. Fargate creates one
# root-owned at 0755, which SHADOWS the image's writable /tmp, so the non-root
# process cannot allocate the scratch the JVM and Tomcat both need. This component
# shipped with that mount and the first task died on it before serving a request.
# Absence cannot be seen in a diff, so it is asserted here.
forbid 'containerPath[^,]*"/tmp"' \
  'a bind mount at /tmp' \
  'Fargate creates bind mounts root-owned at 0755, so uid 1000 cannot write to one (aws/containers-roadmap#938). Mounting /tmp causes the AccessDeniedException it appears to prevent. Restoring a read-only root filesystem needs a managed EBS volume or a root init container - not this mount.'

# --- Constructs that would open a bypass or widen the boundary -----------------

# FR-021. The single most consequential argument in this component. An internet
# facing load balancer would give the origin a public address, and every other
# control here assumes it has none.
forbid '^[[:space:]]*internal[[:space:]]*=[[:space:]]*false' \
  'an internet-facing load balancer' \
  'The origin must have no public address (FR-021). That is what makes the distribution unbypassable by construction rather than by a rule someone can widen.'

# FR-018. A rule that answers on the application path never reaches the
# application, so every authorization control the application enforces is skipped.
forbid '"?(fixed_response|fixed-response)"?' \
  'a fixed-response listener action' \
  'A rule that answers instead of forwarding is a path to the endpoint that bypasses the application (FR-018).'

# FR-004. A mutable tag makes a rollback ambiguous, and re-pushing it does not
# reliably cause a task to be replaced. SCRUM-177 publishes both a commit-SHA tag
# and `latest`; this component runs only the former.
forbid ':latest"|:latest\$|tag[[:space:]]*=[[:space:]]*"latest"' \
  'a mutable image tag' \
  'The service runs an immutable commit-SHA tag (FR-004). A mutable tag denotes different images over time, so a rollback cannot name a build.'

# --- Constructs that belong to another component -------------------------------

# FR-002, SC-027. SCRUM-177 owns the registry (pull request #40). Declaring one
# here would fight that component for the same resource.
forbid '(^|[^a-z_])resource[[:space:]]+"aws_ecr_' \
  'an image registry resource' \
  'SCRUM-177 owns the registry; this component consumes it through remote state (FR-002).'

# FR-053. The one exception is the single inbound rule on the network component's
# application security group, which SCRUM-173 delegated here in that resource's own
# description. Everything else upstream stays untouched.
forbid '(^|[^a-z_])resource[[:space:]]+"aws_(vpc|subnet|nat_gateway|internet_gateway|route_table|db_instance|secretsmanager_secret|iam_role)"' \
  'a resource owned by an upstream component' \
  'The network, secrets, and database components own these (FR-053). Changes to them are changes to those components.'

printf 'ok: %s source guard passed (%d checks)\n' "$component_dir" 11
