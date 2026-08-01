# The stable producer contract consumed by the backend compute component
# (SCRUM-176) through terraform_remote_state. Renaming or retyping any of these is
# a breaking change requiring a coordinated update to every consumer — see
# contracts/terraform-outputs.md.
#
# No output carries a credential value. Every one is a host, a port, a name, or an
# ARN: identifiers, not secrets. None is marked `sensitive` for that reason —
# marking them so would imply these values need protecting and would obscure where
# the real guarantee lives, which is that the master password is in no component's
# state at all (FR-010).
#
# Two of these change when the instance is replaced or restored, deliberately:
# db_instance_address and master_user_secret_arn are both instance-derived
# (FR-040). A consumer reading them through remote state picks the new values up
# on its next plan and apply; a consumer that cached them does not. That is the
# failure REL-003 is written against, and it is why the connection URL is
# published as a parameter NAME rather than as a resolved value.

output "db_instance_address" {
  description = "Hostname of the database instance. For a health probe, a diagnostic, or a future connection pooler. Changes if the instance is replaced or restored — do not cache it."
  value       = aws_db_instance.main.address
}

output "db_instance_port" {
  description = "Port the instance listens on. Always 5432, the only port the network component's ingress rule admits. Published as a value so no consumer hard-codes it."
  value       = aws_db_instance.main.port
}

output "db_name" {
  description = "Name of the initial database, matching the one developers run locally."
  value       = aws_db_instance.main.db_name
}

output "master_user_secret_arn" {
  description = "ARN of the credential the managed database service generates, stores, and rotates. Reference this from a task definition's `secrets` block. This is an identifier, not a value — no Terraform component ever holds the password. Do not append a version id or stage: the service rotates on its own schedule, and a pinned reference makes that rotation break the application."
  value       = aws_db_instance.main.master_user_secret[0].secret_arn
}

output "db_url_parameter_name" {
  description = "Name of the configuration entry holding the JDBC connection URL, under the prefix the secrets component publishes. The NAME rather than the value, so a consumer reads the current URL at task start and a restore is picked up without a redeploy."
  value       = aws_ssm_parameter.db_url.name
}

output "db_subnet_group_name" {
  description = "Subnet group spanning the private subnets in both availability zones. Exists so a later standby, read replica, or restore lands in the same placement without re-deriving it by hand — which is the manual step REL-003's recovery procedure exists to avoid. Not unused."
  value       = aws_db_subnet_group.main.name
}
