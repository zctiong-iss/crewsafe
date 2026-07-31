# The stable producer contract consumed by the Postgres and backend compute
# components through terraform_remote_state. Renaming or retyping any of these,
# or changing list ordering, is a breaking change requiring a coordinated update
# to every consumer — see contracts/terraform-outputs.md.
#
# Subnet lists are ordered to follow var.availability_zones, so index 0 of both
# lists is the same zone and a consumer can pair a load balancer with its tasks
# by index without re-deriving zones.
#
# No CIDR, account identifier, elastic IP, or route table id is exposed:
# consumers have no legitimate need for them, and a smaller surface stays stable.

output "vpc_id" {
  description = "Identifier of the shared development network."
  value       = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "Internet-facing subnets, ordered by var.availability_zones. For the public load balancer."
  value       = [for zone in var.availability_zones : aws_subnet.public[zone].id]
}

output "private_subnet_ids" {
  description = "Private subnets, ordered by var.availability_zones. Host the application runtime and the database; span two zones, satisfying a managed PostgreSQL subnet group's minimum."
  value       = [for zone in var.availability_zones : aws_subnet.private[zone].id]
}

output "app_security_group_id" {
  description = "Attach the backend runtime to this group. Membership is what grants database access."
  value       = aws_security_group.app.id
}

output "database_security_group_id" {
  description = "Attach the PostgreSQL instance to this group. Admits 5432/TCP from app_security_group_id only, and has no egress."
  value       = aws_security_group.database.id
}
