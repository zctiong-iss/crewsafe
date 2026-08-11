output "policy_bindings" {
  description = "Non-secret metadata for the sixteen reviewed customer-managed policies."
  value = {
    for binding_key, binding in local.policy_bindings : binding_key => {
      binding_key      = binding_key
      component        = binding.component
      role_kind        = binding.role_kind
      policy_path      = binding.policy_path
      policy_name      = binding.policy_name
      policy_arn       = aws_iam_policy.component[binding_key].arn
      target_role_arn  = binding.target_role_arn
      target_role_name = binding.target_role_name
    }
  }
}

output "policy_arns" {
  description = "Policy ARNs keyed by the deterministic component-role binding key."
  value       = { for binding_key, policy in aws_iam_policy.component : binding_key => policy.arn }
}

output "policy_names" {
  description = "Policy names keyed by the deterministic component-role binding key."
  value       = { for binding_key, policy in aws_iam_policy.component : binding_key => policy.name }
}

output "attachment_keys" {
  description = "The sixteen deterministic policy attachment keys."
  value       = [for binding_key in sort(keys(aws_iam_role_policy_attachment.component)) : "${binding_key}-attachment"]
}

output "policy_count" {
  description = "Number of customer-managed policies declared by this root."
  value       = length(aws_iam_policy.component)
}

output "attachment_count" {
  description = "Number of explicit role-policy attachments declared by this root."
  value       = length(aws_iam_role_policy_attachment.component)
}
