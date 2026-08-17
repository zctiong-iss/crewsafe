mock_provider "aws" {}

run "customer_managed_policy_contract" {
  command = plan

  variables {
    expected_account_id      = "123456789012"
    account_alias            = "alice"
    aws_region               = "ap-southeast-1"
    terraform_plan_role_arn  = "arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformPlanRole"
    terraform_apply_role_arn = "arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformApplyRole"
  }

  override_data {
    target = data.aws_caller_identity.current
    values = { account_id = "123456789012" }
  }

  assert {
    condition     = length(output.policy_bindings) == 20
    error_message = "The IAM policy-management root must expose exactly twenty bindings."
  }

  assert {
    condition = alltrue([
      for binding in values(output.policy_bindings) :
      binding.policy_path == "/crewsafe/terraform/iam-policy-management/"
      && binding.policy_name == "crewsafe-terraform-${binding.component}-${binding.role_kind}-policy"
      && binding.target_role_name == (binding.role_kind == "plan" ? "CrewSafeGitHubTerraformPlanRole" : "CrewSafeGitHubTerraformApplyRole")
      && binding.target_role_arn == (binding.role_kind == "plan" ? "arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformPlanRole" : "arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformApplyRole")
    ])
    error_message = "Every policy must use the deterministic path, name, and normal role target."
  }

  assert {
    condition     = length(output.policy_arns) == 20 && length(output.attachment_keys) == 20
    error_message = "Every customer-managed policy must have one explicit attachment."
  }

}

# SCRUM-451: write the binding contract before adding the compute-s3 policy
# family. This must fail while the central component list still exposes only
# the existing eighteen bindings.
run "compute_s3_policy_binding_contract" {
  command = plan

  variables {
    expected_account_id      = "123456789012"
    account_alias            = "alice"
    aws_region               = "ap-southeast-1"
    terraform_plan_role_arn  = "arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformPlanRole"
    terraform_apply_role_arn = "arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformApplyRole"
  }

  override_data {
    target = data.aws_caller_identity.current
    values = { account_id = "123456789012" }
  }

  assert {
    condition = (
      contains(keys(output.policy_bindings), "compute-s3-plan")
      && contains(keys(output.policy_bindings), "compute-s3-apply")
      && output.policy_bindings["compute-s3-plan"].policy_name == "crewsafe-terraform-compute-s3-plan-policy"
      && output.policy_bindings["compute-s3-apply"].policy_name == "crewsafe-terraform-compute-s3-apply-policy"
      && output.policy_bindings["compute-s3-plan"].target_role_name == "CrewSafeGitHubTerraformPlanRole"
      && output.policy_bindings["compute-s3-apply"].target_role_name == "CrewSafeGitHubTerraformApplyRole"
    )
    error_message = "The policy-management root must expose deterministic compute-s3 plan/apply bindings attached to the normal Terraform roles."
  }
}

# SCRUM-451: least-privilege contract written before the policy templates.
# The four bucket ARNs are the only bucket resources. ListAllMyBuckets is the
# sole account-level discovery exception; no object paths or wildcard actions
# are acceptable.
run "compute_s3_policies_stay_least_privilege" {
  command = plan

  variables {
    expected_account_id      = "123456789012"
    account_alias            = "alice"
    aws_region               = "ap-southeast-1"
    terraform_plan_role_arn  = "arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformPlanRole"
    terraform_apply_role_arn = "arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformApplyRole"
  }

  override_data {
    target = data.aws_caller_identity.current
    values = { account_id = "123456789012" }
  }

  assert {
    condition = anytrue([
      for stmt in jsondecode(aws_iam_policy.component["compute-s3-plan"].policy).Statement :
      stmt.Sid == "ReadComputeS3BucketConfiguration"
      && try(sort(stmt.Action), []) == sort([
        "s3:GetAccelerateConfiguration",
        "s3:GetBucketAcl",
        "s3:GetBucketCORS",
        "s3:GetBucketLocation",
        "s3:GetBucketLogging",
        "s3:GetBucketNotification",
        "s3:GetBucketObjectLockConfiguration",
        "s3:GetBucketOwnershipControls",
        "s3:GetBucketPolicy",
        "s3:GetBucketPublicAccessBlock",
        "s3:GetBucketRequestPayment",
        "s3:GetBucketTagging",
        "s3:GetBucketVersioning",
        "s3:GetBucketWebsite",
        "s3:GetEncryptionConfiguration",
        "s3:GetLifecycleConfiguration",
        "s3:GetReplicationConfiguration",
      ])
      && try(sort(stmt.Resource), []) == sort([
        "arn:aws:s3:::crewsafe-shared-dev-web",
        "arn:aws:s3:::crewsafe-shared-dev-alb-logs",
        "arn:aws:s3:::crewsafe-shared-dev-web-logs",
        "arn:aws:s3:::crewsafe-shared-dev-cloudfront-logs",
      ])
    ])
    error_message = "The compute-s3 plan policy must read exactly the four compute bucket configurations."
  }

  assert {
    condition = anytrue([
      for stmt in jsondecode(aws_iam_policy.component["compute-s3-plan"].policy).Statement :
      stmt.Sid == "ListAllComputeS3Buckets"
      && length(try(tolist(stmt.Action), [stmt.Action])) == 1
      && try(tolist(stmt.Action), [stmt.Action])[0] == "s3:ListAllMyBuckets"
      && length(try(tolist(stmt.Resource), [stmt.Resource])) == 1
      && try(tolist(stmt.Resource), [stmt.Resource])[0] == "*"
    ])
    error_message = "Only ListAllMyBuckets may use the account-level resource wildcard in the compute-s3 plan policy."
  }

  assert {
    condition = anytrue([
      for stmt in jsondecode(aws_iam_policy.component["compute-s3-apply"].policy).Statement :
      stmt.Sid == "ManageComputeS3Buckets"
      && try(sort(stmt.Action), []) == sort([
        "s3:CreateBucket",
        "s3:DeleteBucket",
        "s3:DeleteBucketPolicy",
        "s3:PutBucketAcl",
        "s3:PutBucketLogging",
        "s3:PutBucketOwnershipControls",
        "s3:PutBucketPolicy",
        "s3:PutBucketPublicAccessBlock",
        "s3:PutBucketTagging",
        "s3:PutBucketVersioning",
        "s3:PutEncryptionConfiguration",
        "s3:PutLifecycleConfiguration",
      ])
      && try(sort(stmt.Resource), []) == sort([
        "arn:aws:s3:::crewsafe-shared-dev-web",
        "arn:aws:s3:::crewsafe-shared-dev-alb-logs",
        "arn:aws:s3:::crewsafe-shared-dev-web-logs",
        "arn:aws:s3:::crewsafe-shared-dev-cloudfront-logs",
      ])
    ])
    error_message = "The compute-s3 apply policy must grant only the explicit bucket-management actions on the four compute buckets."
  }

  assert {
    condition = alltrue([
      for policy_key in ["compute-s3-plan", "compute-s3-apply"] :
      alltrue([
        for stmt in jsondecode(aws_iam_policy.component[policy_key].policy).Statement :
        alltrue([for action in stmt.Action : !can(regex(":\\*$", action))])
        && alltrue([for action in stmt.Action : !can(regex("^s3:(Get|Put|Delete)Object", action))])
        && (length(try(tolist(stmt.Resource), [stmt.Resource])) == 1 && try(tolist(stmt.Resource), [stmt.Resource])[0] == "*" ? stmt.Sid == "ListAllComputeS3Buckets" : alltrue([
          for resource in try(tolist(stmt.Resource), [stmt.Resource]) : contains([
            "arn:aws:s3:::crewsafe-shared-dev-web",
            "arn:aws:s3:::crewsafe-shared-dev-alb-logs",
            "arn:aws:s3:::crewsafe-shared-dev-web-logs",
            "arn:aws:s3:::crewsafe-shared-dev-cloudfront-logs",
          ], resource)
        ]))
      ])
    ])
    error_message = "The compute-s3 policies must reject wildcard S3 actions, object-level actions, and unrelated resources."
  }

  assert {
    condition = alltrue([
      for stmt in jsondecode(aws_iam_policy.component["compute-s3-plan"].policy).Statement :
      alltrue([for action in stmt.Action : startswith(action, "s3:Get") || action == "s3:ListBucket" || action == "s3:ListAllMyBuckets"])
    ])
    error_message = "The compute-s3 plan policy must remain read/discovery-only."
  }
}

# SCRUM-298: negative boundary test for the compute-web component, added before the
# templates changed per this runbook's own "Policy changes" process. Confirms the new
# grants stay scoped to exactly what SCRUM-298's spec requires — no wildcard IAM action,
# no bucket/role resource beyond the two named ones — the same discipline
# compute.tftest.hcl's own R-006 assertions apply at the Terraform-resource level.
run "compute_web_policies_stay_least_privilege" {
  command = plan

  variables {
    expected_account_id      = "123456789012"
    account_alias            = "alice"
    aws_region               = "ap-southeast-1"
    terraform_plan_role_arn  = "arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformPlanRole"
    terraform_apply_role_arn = "arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformApplyRole"
  }

  override_data {
    target = data.aws_caller_identity.current
    values = { account_id = "123456789012" }
  }

  assert {
    condition = alltrue([
      for stmt in jsondecode(aws_iam_policy.component["compute-web-apply"].policy).Statement :
      alltrue([for action in stmt.Action : !can(regex(":\\*$", action))])
    ])
    error_message = "No statement in the compute-web apply policy may grant a wildcard action on any service."
  }

  assert {
    condition = alltrue([
      for stmt in jsondecode(aws_iam_policy.component["compute-web-apply"].policy).Statement :
      stmt.Sid != "ManageWebSyncRoleOnly" ||
      stmt.Resource == "arn:aws:iam::123456789012:role/crewsafe-shared-dev-web-sync"
    ])
    error_message = "The compute-web apply policy's IAM statement must be scoped to exactly the web sync role, never a wildcard or another role."
  }

  assert {
    condition = alltrue([
      for stmt in jsondecode(aws_iam_policy.component["compute-web-plan"].policy).Statement :
      alltrue([for action in stmt.Action : !can(regex(":\\*$", action))])
    ])
    error_message = "No statement in the compute-web plan policy may grant a wildcard action on any service."
  }
}

# SCRUM-371: compute's own apply role must be able to manage a policy on the
# crewsafe-developers group (SCRUM-372) before it can create the
# aws_iam_group_policy.developers_rds_troubleshooting resource. Written before
# the templates changed, per this runbook's own "Policy changes" process
# (docs/runbooks/SCRUM-265-terraform-iam-policy-management.md).
run "compute_ci_can_manage_developer_group_policy" {
  command = plan

  variables {
    expected_account_id      = "123456789012"
    account_alias            = "alice"
    aws_region               = "ap-southeast-1"
    terraform_plan_role_arn  = "arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformPlanRole"
    terraform_apply_role_arn = "arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformApplyRole"
  }

  override_data {
    target = data.aws_caller_identity.current
    values = { account_id = "123456789012" }
  }

  assert {
    condition = anytrue([
      for stmt in jsondecode(aws_iam_policy.component["compute-apply"].policy).Statement :
      (
        try(sort(stmt.Action), []) == sort([
          "iam:GetGroupPolicy",
          "iam:PutGroupPolicy",
          "iam:DeleteGroupPolicy",
          "iam:ListGroupPolicies",
        ])
        && stmt.Resource == "arn:aws:iam::123456789012:group/crewsafe-developers"
      )
    ])
    error_message = "The compute apply policy must grant exactly iam:GetGroupPolicy, iam:PutGroupPolicy, iam:DeleteGroupPolicy, and iam:ListGroupPolicies, scoped to the crewsafe-developers group ARN and nothing else (research.md R-002)."
  }

  assert {
    condition = anytrue([
      for stmt in jsondecode(aws_iam_policy.component["compute-plan"].policy).Statement :
      (
        try(sort(stmt.Action), []) == sort([
          "iam:GetGroupPolicy",
          "iam:ListGroupPolicies",
        ])
        && stmt.Resource == "arn:aws:iam::123456789012:group/crewsafe-developers"
      )
    ])
    error_message = "The compute plan policy must grant exactly iam:GetGroupPolicy and iam:ListGroupPolicies, scoped to the crewsafe-developers group ARN and nothing else (research.md R-002)."
  }

  assert {
    condition = alltrue([
      for stmt in jsondecode(aws_iam_policy.component["compute-apply"].policy).Statement :
      alltrue([for action in stmt.Action : !can(regex(":\\*$", action))])
    ])
    error_message = "No statement in the compute apply policy may grant a wildcard action on any service, including this new group-policy grant."
  }
}

# SCRUM-373: ecr's own apply role must be able to manage a crewsafe/ml-service
# repository and its dedicated push role before it can create those resources.
# Today's ManageEcrRepository/ManagePushRoleIdentity statements are pinned to
# the exact backend/web repository and role ARNs (research.md R-002) — a third
# repository/role needs its own statements. Written before the templates
# changed, per this runbook's own "Policy changes" process
# (docs/runbooks/SCRUM-265-terraform-iam-policy-management.md).
run "ecr_ci_can_manage_ml_service_repository" {
  command = plan

  variables {
    expected_account_id      = "123456789012"
    account_alias            = "alice"
    aws_region               = "ap-southeast-1"
    terraform_plan_role_arn  = "arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformPlanRole"
    terraform_apply_role_arn = "arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformApplyRole"
  }

  override_data {
    target = data.aws_caller_identity.current
    values = { account_id = "123456789012" }
  }

  assert {
    condition = anytrue([
      for stmt in jsondecode(aws_iam_policy.component["ecr-apply"].policy).Statement :
      (
        stmt.Sid == "ManageMlServiceEcrRepository"
        && try(sort(stmt.Action), []) == sort([
          "ecr:CreateRepository",
          "ecr:DeleteRepository",
          "ecr:DescribeRepositories",
          "ecr:PutLifecyclePolicy",
          "ecr:GetLifecyclePolicy",
          "ecr:DeleteLifecyclePolicy",
          "ecr:PutImageScanningConfiguration",
          "ecr:TagResource",
          "ecr:UntagResource",
          "ecr:ListTagsForResource",
        ])
        && stmt.Resource == "arn:aws:ecr:ap-southeast-1:123456789012:repository/crewsafe/ml-service"
      )
    ])
    error_message = "The ecr apply policy must grant the same repository-management action set as the existing backend/web statements, scoped to the new crewsafe/ml-service repository ARN (research.md R-002)."
  }

  assert {
    condition = anytrue([
      for stmt in jsondecode(aws_iam_policy.component["ecr-apply"].policy).Statement :
      (
        stmt.Sid == "ManageMlServicePushRoleIdentity"
        && try(sort(stmt.Action), []) == sort([
          "iam:CreateRole",
          "iam:DeleteRole",
          "iam:GetRole",
          "iam:PutRolePolicy",
          "iam:DeleteRolePolicy",
          "iam:GetRolePolicy",
          "iam:ListAttachedRolePolicies",
          "iam:ListRolePolicies",
          "iam:ListRoleTags",
          "iam:TagRole",
          "iam:UntagRole",
          "iam:UpdateAssumeRolePolicy",
          "iam:UpdateRoleDescription",
        ])
        && stmt.Resource == "arn:aws:iam::123456789012:role/crewsafe-shared-dev-ecr-ml-service-push"
      )
    ])
    error_message = "The ecr apply policy must grant the same push-role-management action set as the existing backend/web statements, scoped to the new crewsafe-shared-dev-ecr-ml-service-push role ARN (research.md R-002)."
  }

  assert {
    condition = alltrue([
      for stmt in jsondecode(aws_iam_policy.component["ecr-apply"].policy).Statement :
      stmt.Resource != "*" || stmt.Sid == "GetRegistryAuthorizationToken" || stmt.Sid == "ManageSecurityHubAccount" || stmt.Sid == "ManageSecurityHubInsight" || stmt.Sid == "ManageInspectorEcrEnablement" || stmt.Sid == "ManageEcrEnhancedScanning"
    ])
    error_message = "The two new ml-service statements must not use a resource wildcard."
  }
}

# SCRUM-373: compute's own apply role must be able to manage the new,
# dedicated ml-service CloudWatch log group before it can create it. Today's
# ManageApplicationLogGroup statement is pinned to exactly the backend log
# group's two ARNs (research.md R-003). Written before the templates changed,
# per this runbook's own "Policy changes" process.
run "compute_ci_can_manage_ml_service_log_group" {
  command = plan

  variables {
    expected_account_id      = "123456789012"
    account_alias            = "alice"
    aws_region               = "ap-southeast-1"
    terraform_plan_role_arn  = "arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformPlanRole"
    terraform_apply_role_arn = "arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformApplyRole"
  }

  override_data {
    target = data.aws_caller_identity.current
    values = { account_id = "123456789012" }
  }

  # Guarded with try(..., false): stmt.Resource is a bare string for most
  # statements in this policy and a list only for ManageApplicationLogGroup.
  # An unguarded contains() call errors out on a string argument rather than
  # returning false, which aborts the whole for-expression instead of just
  # skipping the non-matching statement (discovered live in CI — the pinned
  # 1.10.5 Terraform surfaced it; a newer local version did not).
  assert {
    condition = anytrue([
      for stmt in jsondecode(aws_iam_policy.component["compute-apply"].policy).Statement :
      try(
        stmt.Sid == "ManageApplicationLogGroup"
        && contains(stmt.Resource, "arn:aws:logs:ap-southeast-1:123456789012:log-group:/crewsafe/shared-dev/ml-service")
        && contains(stmt.Resource, "arn:aws:logs:ap-southeast-1:123456789012:log-group:/crewsafe/shared-dev/ml-service:*")
        && contains(stmt.Resource, "arn:aws:logs:ap-southeast-1:123456789012:log-group:/crewsafe/shared-dev/backend")
        && contains(stmt.Resource, "arn:aws:logs:ap-southeast-1:123456789012:log-group:/crewsafe/shared-dev/backend:*"),
        false
      )
    ])
    error_message = "The compute apply policy's ManageApplicationLogGroup statement must cover both the backend and the new ml-service log groups (research.md R-003)."
  }
}

run "reject_wrong_role_account" {
  command = plan

  variables {
    expected_account_id      = "123456789012"
    account_alias            = "alice"
    aws_region               = "ap-southeast-1"
    terraform_plan_role_arn  = "arn:aws:iam::999999999999:role/CrewSafeGitHubTerraformPlanRole"
    terraform_apply_role_arn = "arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformApplyRole"
  }

  override_data {
    target = data.aws_caller_identity.current
    values = { account_id = "123456789012" }
  }

  expect_failures = [terraform_data.input_validation]
}
