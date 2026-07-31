data "aws_caller_identity" "current" {}

locals {
  name_prefix = "crewsafe-shared-dev"

  # Per-tier, per-zone /24 blocks. Public takes cidrsubnet indices 0-1 and
  # private 10-11; the gap lets either tier grow without renumbering the other.
  public_subnets = {
    for index, zone in var.availability_zones :
    zone => cidrsubnet(var.vpc_cidr_block, 8, index)
  }
  private_subnets = {
    for index, zone in var.availability_zones :
    zone => cidrsubnet(var.vpc_cidr_block, 8, index + 10)
  }

  # The zone hosting the single NAT gateway. Egress is not zone-redundant; see
  # REL-005 in the specification for why that trade was accepted.
  egress_zone = var.availability_zones[0]
}

# ---------------------------------------------------------------------------
# Network
# ---------------------------------------------------------------------------

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr_block
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = local.name_prefix }

  lifecycle {
    precondition {
      condition     = data.aws_caller_identity.current.account_id == var.expected_account_id
      error_message = "Authenticated AWS account does not match the selected registry account."
    }
  }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = { Name = "${local.name_prefix}-igw" }
}

resource "aws_subnet" "public" {
  for_each = local.public_subnets

  vpc_id            = aws_vpc.main.id
  availability_zone = each.key
  cidr_block        = each.value

  # A public address is the consumer's explicit choice, never a default (FR-008).
  map_public_ip_on_launch = false

  tags = { Name = "${local.name_prefix}-public-${each.key}" }
}

resource "aws_subnet" "private" {
  for_each = local.private_subnets

  vpc_id            = aws_vpc.main.id
  availability_zone = each.key
  cidr_block        = each.value

  tags = { Name = "${local.name_prefix}-private-${each.key}" }
}

# ---------------------------------------------------------------------------
# Egress
# ---------------------------------------------------------------------------

resource "aws_eip" "nat" {
  domain = "vpc"

  tags = { Name = "${local.name_prefix}-nat" }
}

resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[local.egress_zone].id

  tags = { Name = "${local.name_prefix}-nat" }

  depends_on = [aws_internet_gateway.main]
}

# ---------------------------------------------------------------------------
# Routing
# ---------------------------------------------------------------------------

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "${local.name_prefix}-public" }
}

# The private tier reaches the internet outbound through the NAT gateway only.
# There is deliberately no internet gateway route here: replies to outbound
# requests return on the established connection, which is not an inbound route.
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main.id
  }

  tags = { Name = "${local.name_prefix}-private" }
}

resource "aws_route_table_association" "public" {
  for_each = aws_subnet.public

  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  for_each = aws_subnet.private

  subnet_id      = each.value.id
  route_table_id = aws_route_table.private.id
}

# ---------------------------------------------------------------------------
# Access control
#
# Both groups are declared with no inline ingress/egress blocks; every rule is a
# separate aws_vpc_security_group_*_rule resource. Mixing the two styles causes
# rules to be perpetually added and removed, and separate resources make rule
# counts directly assertable in tests.
# ---------------------------------------------------------------------------

resource "aws_security_group" "app" {
  name        = "${local.name_prefix}-app"
  description = "Application runtime. Membership grants database access; no inbound rule is defined here because the load balancer's ingress belongs to the compute component."
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${local.name_prefix}-app" }
}

resource "aws_security_group" "database" {
  name        = "${local.name_prefix}-database"
  description = "PostgreSQL boundary. Admits the application runtime on 5432 and nothing else; declares no egress rule at all."
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${local.name_prefix}-database" }
}

resource "aws_vpc_security_group_ingress_rule" "database_from_app" {
  security_group_id            = aws_security_group.database.id
  description                  = "PostgreSQL from the application runtime only, by security group reference so no address range can widen it."
  referenced_security_group_id = aws_security_group.app.id
  from_port                    = var.database_port
  to_port                      = var.database_port
  ip_protocol                  = "tcp"
}

# The database group has NO egress rule. This is the requirement, not an
# omission: declaring none causes Terraform to revoke the allow-all rule AWS
# attaches at creation, closing the outbound path that sharing the private tier
# with the application runtime would otherwise hand the database.
# Verified in the plan output, which a mocked test cannot observe.

resource "aws_vpc_security_group_egress_rule" "app_all" {
  security_group_id = aws_security_group.app.id
  description       = "Unrestricted outbound for container image pulls, dependency retrieval, and approved external services such as the weather API, routed through the NAT gateway."
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

# FR-012 — declared with no rules so the provider strips the VPC's default
# group. A resource attached to it by accident is permitted nothing.
resource "aws_default_security_group" "main" {
  vpc_id = aws_vpc.main.id

  tags = { Name = "${local.name_prefix}-default-locked" }
}
