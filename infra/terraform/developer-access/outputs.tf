# Producer contract for SCRUM-371 (contracts/terraform-outputs.md). No output ever
# references a password or access-key attribute — neither exists here even indirectly.

output "developer_group_name" {
  description = "Name of the crewsafe-developers IAM group. SCRUM-371 attaches its ECS Exec / secret-read policy here rather than creating a second group."
  value       = aws_iam_group.developers.name
}

output "developer_group_arn" {
  description = "ARN of the crewsafe-developers IAM group."
  value       = aws_iam_group.developers.arn
}

output "developer_user_names" {
  description = "Every developer username currently provisioned, in developers.auto.tfvars order."
  value       = [for d in var.developers : d.username]
}

output "developer_user_arns" {
  description = "Username to user ARN, for anything genuinely per-person."
  value       = { for k, u in aws_iam_user.developer : k => u.arn }
}
