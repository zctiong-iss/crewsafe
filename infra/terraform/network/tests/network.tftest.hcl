# Infrastructure tests for the crewsafe shared-dev network baseline (SCRUM-173).
#
# Every run block plans against a mocked provider, so no AWS account, credential,
# or network call is involved. The database boundary assertions in
# "database_boundary" are the load-bearing controls for this component: with a
# two-tier topology there is no routing layer behind the security group, so these
# are the only thing standing between the database and the internet.

mock_provider "aws" {}

# The mocked provider fabricates a random account id, which would trip the VPC's
# account precondition in every run. Pin it once here so each run exercises what
# it is actually about; "rejects_mismatched_account" varies expected_account_id
# against this fixed identity to prove the precondition still bites.
override_data {
  target = data.aws_caller_identity.current
  values = { account_id = "123456789012" }
}

# Ids are computed by AWS, so a resource referencing another is "not yet known"
# and no cross-resource assertion could be evaluated. Pinning them makes the
# routing posture, the boundary, and the output contract assertable.
#
# These run blocks use `command = apply` against the mocked provider: on
# Terraform 1.10.5 (the version CI pins) overrides are not surfaced during the
# plan phase, and the `override_during` argument that would change that does not
# exist until a later release. A mocked apply creates nothing — it resolves
# computed values so the assertions can run.
override_resource {
  target = aws_vpc.main
  values = { id = "vpc-0123456789abcdef0" }
}

override_resource {
  target = aws_internet_gateway.main
  values = { id = "igw-0123456789abcdef0" }
}

override_resource {
  target = aws_subnet.public["ap-southeast-1a"]
  values = { id = "subnet-public-1a" }
}

override_resource {
  target = aws_subnet.public["ap-southeast-1b"]
  values = { id = "subnet-public-1b" }
}

override_resource {
  target = aws_subnet.private["ap-southeast-1a"]
  values = { id = "subnet-private-1a" }
}

override_resource {
  target = aws_subnet.private["ap-southeast-1b"]
  values = { id = "subnet-private-1b" }
}

override_resource {
  target = aws_nat_gateway.main
  values = { id = "nat-0123456789abcdef0" }
}

override_resource {
  target = aws_security_group.app
  values = { id = "sg-0aaaaaaaaaaaaaaaa" }
}

override_resource {
  target = aws_security_group.database
  values = { id = "sg-0bbbbbbbbbbbbbbbb" }
}

variables {
  expected_account_id = "123456789012"
  account_alias       = "shared-dev"
  availability_zones  = ["ap-southeast-1a", "ap-southeast-1b"]
  vpc_cidr_block      = "10.0.0.0/16"
}

# ---------------------------------------------------------------------------
# Input validation (SEC-002) — every dispatch input is untrusted.
# ---------------------------------------------------------------------------

run "rejects_malformed_account_id" {
  command = plan
  variables {
    expected_account_id = "12345"
  }
  expect_failures = [var.expected_account_id]
}

run "rejects_region_outside_ap_southeast_1" {
  command = plan
  variables {
    aws_region = "us-east-1"
  }
  expect_failures = [var.aws_region]
}

run "rejects_single_availability_zone" {
  command = plan
  variables {
    availability_zones = ["ap-southeast-1a"]
  }
  expect_failures = [var.availability_zones]
}

run "rejects_availability_zone_outside_region" {
  command = plan
  variables {
    availability_zones = ["ap-southeast-1a", "us-east-1a"]
  }
  expect_failures = [var.availability_zones]
}

run "rejects_duplicate_availability_zones" {
  command = plan
  variables {
    availability_zones = ["ap-southeast-1a", "ap-southeast-1a"]
  }
  expect_failures = [var.availability_zones]
}

run "rejects_non_slug_account_alias" {
  command = plan
  variables {
    account_alias = "Not_An_Alias"
  }
  expect_failures = [var.account_alias]
}

run "rejects_malformed_vpc_cidr" {
  command = plan
  variables {
    vpc_cidr_block = "not-a-cidr"
  }
  expect_failures = [var.vpc_cidr_block]
}

run "rejects_oversized_vpc_prefix" {
  command = plan
  variables {
    vpc_cidr_block = "10.0.0.0/24"
  }
  expect_failures = [var.vpc_cidr_block]
}

run "rejects_non_postgres_database_port" {
  command = plan
  variables {
    database_port = 3306
  }
  expect_failures = [var.database_port]
}

# ---------------------------------------------------------------------------
# US1 — network topology (FR-002 to FR-008)
# ---------------------------------------------------------------------------

run "topology" {
  command = apply

  assert {
    condition     = aws_vpc.main.cidr_block == "10.0.0.0/16"
    error_message = "The network address range changed."
  }

  assert {
    condition     = length(aws_subnet.public) == 2 && length(aws_subnet.private) == 2
    error_message = "The network must have exactly two subnets in each tier (FR-002, FR-003)."
  }

  assert {
    condition = (
      length(distinct([for s in values(aws_subnet.public) : s.availability_zone])) == 2
      && length(distinct([for s in values(aws_subnet.private) : s.availability_zone])) == 2
    )
    error_message = "Each tier must span two distinct availability zones (FR-002, REL-002, SC-007)."
  }

  assert {
    condition = (
      aws_subnet.public["ap-southeast-1a"].cidr_block == "10.0.0.0/24"
      && aws_subnet.public["ap-southeast-1b"].cidr_block == "10.0.1.0/24"
      && aws_subnet.private["ap-southeast-1a"].cidr_block == "10.0.10.0/24"
      && aws_subnet.private["ap-southeast-1b"].cidr_block == "10.0.11.0/24"
    )
    error_message = "The per-tier, per-zone address plan changed."
  }

  assert {
    condition     = alltrue([for s in values(aws_subnet.public) : s.map_public_ip_on_launch == false])
    error_message = "Public subnets must not auto-assign public addresses (FR-008)."
  }

  assert {
    condition = anytrue([
      for r in aws_route_table.public.route :
      r.cidr_block == "0.0.0.0/0" && r.gateway_id == aws_internet_gateway.main.id
    ])
    error_message = "The public tier must default-route to the internet gateway (FR-004)."
  }

  assert {
    condition = anytrue([
      for r in aws_route_table.private.route :
      r.cidr_block == "0.0.0.0/0" && r.nat_gateway_id == aws_nat_gateway.main.id
    ])
    error_message = "The private tier must default-route to the NAT gateway (FR-007)."
  }

  assert {
    condition = alltrue([
      for r in aws_route_table.private.route : r.gateway_id == null || r.gateway_id == ""
    ])
    error_message = "The private tier must have no route to the internet gateway (FR-005)."
  }

  assert {
    condition     = length(aws_route_table_association.public) == 2 && length(aws_route_table_association.private) == 2
    error_message = "Every subnet must be associated with its tier's route table."
  }
}

run "rejects_mismatched_account" {
  command = plan

  variables {
    expected_account_id = "999999999999"
  }

  expect_failures = [aws_vpc.main]
}

# ---------------------------------------------------------------------------
# US2 — the database boundary (FR-009 to FR-014, FR-025, FR-026)
#
# These are the load-bearing controls. The two-tier topology puts the database
# in the same private tier as the application runtime, so routing provides no
# second barrier: if these assertions pass while the rules are wrong, nothing
# else catches it. "database_ingress_is_never_internet_facing" in particular
# must be observed FAILING against a widened rule before it is trusted.
# ---------------------------------------------------------------------------

run "database_boundary" {
  command = apply

  assert {
    condition     = aws_vpc_security_group_ingress_rule.database_from_app.security_group_id == aws_security_group.database.id
    error_message = "The ingress rule must attach to the database security group (FR-010)."
  }

  assert {
    condition     = aws_vpc_security_group_ingress_rule.database_from_app.referenced_security_group_id == aws_security_group.app.id
    error_message = "Database ingress must be sourced from the application-runtime security group by group reference (FR-010)."
  }

  # The regression this component exists to prevent: a CIDR source of any kind
  # on the database's ingress rule. 0.0.0.0/0 is the catastrophic case, but any
  # literal range is wrong here — only a group reference is permitted.
  assert {
    condition = (
      aws_vpc_security_group_ingress_rule.database_from_app.cidr_ipv4 == null
      && aws_vpc_security_group_ingress_rule.database_from_app.cidr_ipv6 == null
    )
    error_message = "Database ingress must never use a CIDR source, and never 0.0.0.0/0 or ::/0 (FR-011)."
  }

  assert {
    condition = (
      aws_vpc_security_group_ingress_rule.database_from_app.from_port == 5432
      && aws_vpc_security_group_ingress_rule.database_from_app.to_port == 5432
      && aws_vpc_security_group_ingress_rule.database_from_app.ip_protocol == "tcp"
    )
    error_message = "Database ingress must admit PostgreSQL on 5432/TCP only (FR-010)."
  }

  # No inbound administrative access anywhere in this component (FR-014).
  assert {
    condition = alltrue([
      for port in [22, 3389] :
      !(aws_vpc_security_group_ingress_rule.database_from_app.from_port <= port
      && aws_vpc_security_group_ingress_rule.database_from_app.to_port >= port)
    ])
    error_message = "No security group may admit remote shell or remote desktop access (FR-014)."
  }

  assert {
    condition     = aws_vpc_security_group_egress_rule.app_all.cidr_ipv4 == "0.0.0.0/0" && aws_vpc_security_group_egress_rule.app_all.ip_protocol == "-1"
    error_message = "The application runtime must have unrestricted outbound access through the NAT gateway (FR-025)."
  }

  assert {
    condition     = aws_vpc_security_group_egress_rule.app_all.security_group_id == aws_security_group.app.id
    error_message = "The unrestricted egress rule must belong to the application group, not the database group (FR-025, FR-026)."
  }

  # FR-012 — the VPC's default group is adopted and stripped. Its rule sets are
  # computed, so "zero rules" is unknowable at plan time and cannot be asserted
  # here; what IS assertable is that the resource is declared against our VPC,
  # which is what causes the provider to revoke the rules. The zero-rule outcome
  # is verified by reading the plan output, alongside the database's zero egress
  # (research.md R-006).
  assert {
    condition     = aws_default_security_group.main.vpc_id == aws_vpc.main.id
    error_message = "The VPC's default security group must be adopted and stripped (FR-012)."
  }

  # FR-013 — a reviewer must be able to audit intent without external context.
  assert {
    condition = (
      aws_vpc_security_group_ingress_rule.database_from_app.description != null
      && aws_vpc_security_group_ingress_rule.database_from_app.description != ""
      && aws_vpc_security_group_egress_rule.app_all.description != null
      && aws_vpc_security_group_egress_rule.app_all.description != ""
    )
    error_message = "Every security group rule must describe what it permits and why (FR-013)."
  }

  # AWS restricts descriptions to a-zA-Z0-9 and . _-:/()#,@[]+=&;{}!$* — note the
  # absence of the apostrophe. A character outside that set is accepted by
  # validate and by plan, then rejected by the EC2 API mid-apply, leaving a
  # partially provisioned network. Asserting the charset turns a runtime failure
  # into a test failure.
  assert {
    condition = alltrue([
      for d in [
        aws_security_group.app.description,
        aws_security_group.database.description,
        aws_vpc_security_group_ingress_rule.database_from_app.description,
        aws_vpc_security_group_egress_rule.app_all.description,
      ] : can(regex("^[a-zA-Z0-9. _\\-:/()#,@\\[\\]+=&;{}!$*]+$", d)) && length(d) < 256
    ])
    error_message = "A security group description uses a character AWS rejects, or exceeds 255 characters. Allowed: a-zA-Z0-9 and . _-:/()#,@[]+=&;{}!$* — an apostrophe is not."
  }
}

# ---------------------------------------------------------------------------
# US3 — the producer contract (FR-019)
#
# Output names and list ordering are contractual: the Postgres and compute
# components bind to these names, and rely on index 0 of both subnet lists
# being the same availability zone.
# ---------------------------------------------------------------------------

run "producer_contract" {
  command = apply

  assert {
    condition     = output.vpc_id == aws_vpc.main.id
    error_message = "vpc_id must expose the network identifier (FR-019)."
  }

  assert {
    condition     = length(output.public_subnet_ids) == 2 && length(output.private_subnet_ids) == 2
    error_message = "Both subnet lists must contain exactly two entries (FR-019)."
  }

  # An RDS subnet group needs two availability zones; a consumer must get that
  # from private_subnet_ids without re-deriving zones itself (US3 scenario 2).
  assert {
    condition = length(distinct([
      for id in output.private_subnet_ids :
      [for s in values(aws_subnet.private) : s.availability_zone if s.id == id][0]
    ])) == 2
    error_message = "private_subnet_ids must span two availability zones for a managed PostgreSQL subnet group (US3 scenario 2)."
  }

  # Ordering is contractual: index 0 of both lists is the same zone.
  assert {
    condition = (
      output.public_subnet_ids[0] == aws_subnet.public[var.availability_zones[0]].id
      && output.private_subnet_ids[0] == aws_subnet.private[var.availability_zones[0]].id
      && output.public_subnet_ids[1] == aws_subnet.public[var.availability_zones[1]].id
      && output.private_subnet_ids[1] == aws_subnet.private[var.availability_zones[1]].id
    )
    error_message = "Subnet list ordering must follow var.availability_zones so consumers can pair by index (contracts/terraform-outputs.md)."
  }

  assert {
    condition = (
      output.app_security_group_id == aws_security_group.app.id
      && output.database_security_group_id == aws_security_group.database.id
    )
    error_message = "Both security group identifiers must be published (FR-019)."
  }
}
