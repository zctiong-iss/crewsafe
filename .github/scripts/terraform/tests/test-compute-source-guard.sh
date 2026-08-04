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
#   2. The recovery-stage load balancer must stay internal. Apply run 30880087606
#      proved that replacing it while CloudFront still references its surviving
#      VPC origin creates a destructive dependency race.
#   3. The application owns its schema transition. Flyway runs in-process before
#      traffic is accepted, with Hibernate pinned to `validate`. A task-definition
#      override, a second container, or a command override would re-open what
#      SCRUM-175's obligations 1 and 2 closed.
#   4. No shared origin-authentication secret may exist. The attempted public
#      variant needed no header, and the recovery VPC-origin path needs none either;
#      forbidding one stops it returning by accident.
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
  # Process substitution, NOT `scan | grep -Eq`. With `set -o pipefail`, grep -q's
  # early exit on the FIRST match can SIGPIPE sed before it finishes writing the
  # rest of scan()'s output; pipefail then reports the pipeline's exit status as
  # sed's SIGPIPE death (141) rather than grep's successful match (0), and this
  # `if` silently takes the wrong branch — the guard reports a clean pass while the
  # forbidden pattern is sitting in the file. Confirmed reproducible against
  # `internal = false` while writing SCRUM-176's public-load-balancer change: the
  # match is real, `grep -n` finds it, but `if scan | grep -Eq ...` took the pass
  # branch anyway. `< <(scan)` reads from a substituted process whose exit status
  # is not part of this command's pipeline, so pipefail cannot poison it.
  if grep -Eq -- "$pattern" < <(scan); then
    printf 'FAIL: %s declares %s.\n  %s\n' "$component_dir" "$label" "$reason" >&2
    grep -En -- "$pattern" < <(scan) | head -5 >&2
    grep -En -- "$pattern" "${tf_files[@]}" | head -5 >&2
    exit 1
  fi
}

# Positive companion to forbid(). Stage migrations need to prove that old and new
# identities coexist; categorical absence checks alone cannot see a missing path.
require() {
  local pattern="$1" label="$2" reason="$3"
  if ! grep -Eq -- "$pattern" < <(scan); then
    printf 'FAIL: %s is missing %s.\n  %s\n' "$component_dir" "$label" "$reason" >&2
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

# FR-022a. The header-based variant of a fenced public load balancer needed a
# shared secret in state, which SCRUM-174 and SCRUM-175 forbid categorically. This
# component fences with CloudFront's managed prefix list alone (see
# aws_security_group.lb in main.tf) and was never entitled to grow a header back in
# as a "belt and suspenders" addition.
forbid '[Xx]-[Oo]rigin-[Vv]erify|origin_secret|origin_shared_secret|custom_header' \
  'an origin-authentication header' \
  "A shared origin-authentication secret would need to live in Terraform state (FR-022a, forbidden categorically). The prefix list is the origin's only fence and needs no secret."

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

require 'resource[[:space:]]+"aws_lb"[[:space:]]+"public"' \
  'the active public load balancer identity' \
  'Cleanup must preserve the verified origin selected by CloudFront.'

require 'resource[[:space:]]+"aws_security_group"[[:space:]]+"lb"' \
  'the temporarily managed legacy load-balancer security group' \
  'The failed cleanup left this group attached to the surviving deletion-protected ALB; remediation must adopt it without recreating it.'

require 'resource[[:space:]]+"aws_lb"[[:space:]]+"main"' \
  'the temporarily managed legacy load balancer' \
  'Remediation must adopt the surviving ALB so a reviewed apply can disable deletion protection before final cleanup.'

require 'enable_deletion_protection[[:space:]]*=[[:space:]]*false' \
  'disabled deletion protection on the surviving legacy ALB' \
  'The remediation revision must change only this protection flag; final cleanup happens in a later reviewed revision.'

require 'data[[:space:]]+"aws_ec2_managed_prefix_list"[[:space:]]+"cloudfront"' \
  'the AWS-managed CloudFront origin-facing prefix list' \
  'The parallel origin must fail closed to CloudFronts published origin-facing addresses.'

require 'custom_origin_config[[:space:]]*\{' \
  'the public ALB custom-origin configuration' \
  'Cutover must select the verified public ALB rather than the failing VPC-origin route.'

require 'domain_name[[:space:]]*=[[:space:]]*aws_lb\.public\.dns_name' \
  'the public ALB as the existing distribution origin' \
  'The stable backend origin must point to the public ALB without replacing the distribution.'

forbid 'resource[[:space:]]+"aws_cloudfront_vpc_origin"' \
  'a legacy CloudFront VPC origin' \
  'Cleanup is allowed only after CloudFront has deployed and passed evidence on the public custom origin.'

forbid 'resource[[:space:]]+"aws_lb_target_group"[[:space:]]+"backend"' \
  'the legacy target group' \
  'The ECS service must retain only its active public target-group attachment.'

forbid 'resource[[:space:]]+"aws_lb_listener"[[:space:]]+"backend"' \
  'the legacy listener' \
  'Cleanup removes the unreferenced internal path.'

forbid 'resource[[:space:]]+"aws_vpc_security_group_(ingress|egress)_rule"[[:space:]]+"(lb_from_vpc_origin|lb_to_app|app_from_lb)"' \
  'legacy load-balancer connectivity rules' \
  'Remediation adopts only the surviving ALB and its attached empty security group; no legacy traffic path may return.'

load_balancer_blocks="$(grep -Ec '^[[:space:]]*load_balancer[[:space:]]*\{' < <(scan))"
[[ "$load_balancer_blocks" -eq 1 ]] ||
  fail "$component_dir must retain exactly one ECS load_balancer attachment after cleanup (found $load_balancer_blocks)"

forbid '(^|[[:space:]])cidr_ipv4[[:space:]]*=[[:space:]]*"0\.0\.0\.0/0"' \
  'a security group rule admitting the whole internet' \
  'No recovery-stage resource may admit the whole internet (FR-021).'

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

# Terraform reads the entries behind the AWS-managed CloudFront prefix list while
# refreshing the data source. Both workflows refresh it, so both roles need this
# read-only verb; DescribeManagedPrefixLists alone is insufficient.
for policy in plan-role-policy.json apply-role-policy.json; do
  jq -e '
    any(.Statement[];
      .Effect == "Allow" and
      ((.Action | arrays | index("ec2:GetManagedPrefixListEntries")) != null)
    )
  ' "$ROOT/$component_dir/iam/$policy" >/dev/null ||
    fail "$component_dir/iam/$policy must allow ec2:GetManagedPrefixListEntries"
done

# Reviewed source reaches final least privilege. The already-deployed policies
# retain these verbs through the cleanup refresh/deletion and are reconciled from
# these narrower files immediately after the VPC origin is gone.
for policy in plan-role-policy.json apply-role-policy.json; do
  jq -e '[.Statement[].Action | arrays[]] | index("cloudfront:GetVpcOrigin") == null' \
    "$ROOT/$component_dir/iam/$policy" >/dev/null ||
    fail "$component_dir/iam/$policy must remove cloudfront:GetVpcOrigin after cleanup"
done

jq -e '[.Statement[].Action | arrays[]] | index("cloudfront:DeleteVpcOrigin") == null' \
  "$ROOT/$component_dir/iam/apply-role-policy.json" >/dev/null ||
  fail "$component_dir/iam/apply-role-policy.json must remove cloudfront:DeleteVpcOrigin after cleanup"

printf 'ok: %s cleanup-remediation source guard passed (%d checks)\n' "$component_dir" 31
