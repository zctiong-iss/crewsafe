mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "123456789012"
      arn        = "arn:aws:iam::123456789012:role/test"
      user_id    = "test"
    }
  }
}

run "creates_isolated_secure_backend" {
  command = plan

  variables {
    expected_account_id = "123456789012"
    account_alias       = "member-one"
    aws_region          = "ap-southeast-1"
  }

  assert {
    condition     = aws_s3_bucket.terraform_state.bucket == "crewsafe-terraform-state-123456789012-ap-southeast-1"
    error_message = "The state bucket must be isolated by AWS account ID and Region."
  }

  assert {
    condition     = aws_s3_bucket.terraform_state.force_destroy == false
    error_message = "The state bucket must not permit force destruction."
  }

  assert {
    condition     = one(aws_s3_bucket_versioning.terraform_state.versioning_configuration).status == "Enabled"
    error_message = "S3 versioning must be enabled."
  }

  assert {
    condition     = one(one(aws_s3_bucket_server_side_encryption_configuration.terraform_state.rule).apply_server_side_encryption_by_default).sse_algorithm == "AES256"
    error_message = "The bucket must use AES256 server-side encryption."
  }

  assert {
    condition     = one(aws_s3_bucket_ownership_controls.terraform_state.rule).object_ownership == "BucketOwnerEnforced"
    error_message = "The bucket must enforce bucket-owner ownership."
  }

  assert {
    condition = alltrue([
      aws_s3_bucket_public_access_block.terraform_state.block_public_acls,
      aws_s3_bucket_public_access_block.terraform_state.block_public_policy,
      aws_s3_bucket_public_access_block.terraform_state.ignore_public_acls,
      aws_s3_bucket_public_access_block.terraform_state.restrict_public_buckets,
    ])
    error_message = "Every S3 public-access block control must be enabled."
  }
}

run "rejects_authenticated_account_mismatch" {
  command = plan

  variables {
    expected_account_id = "999999999999"
    account_alias       = "member-two"
    aws_region          = "ap-southeast-1"
  }

  expect_failures = [aws_s3_bucket.terraform_state]
}

# SCRUM-443, terraform:S6258 — the state bucket itself had no access logging.
# Self-logging (target == source) closes the gap without a second bucket in
# this foundational, single-bucket root module, mirroring the compute
# component's own web_logs self-logging precedent (SCRUM-414).
run "state_bucket_self_logging" {
  command = plan

  variables {
    expected_account_id = "123456789012"
    account_alias       = "member-one"
    aws_region          = "ap-southeast-1"
  }

  assert {
    condition     = aws_s3_bucket_logging.terraform_state.target_bucket == aws_s3_bucket.terraform_state.bucket
    error_message = "The state bucket must log its own access to itself (self-logging), not a separate bucket."
  }

  assert {
    condition     = aws_s3_bucket_logging.terraform_state.target_prefix == "access-logs/"
    error_message = "State bucket access logs must be delivered under the access-logs/ prefix so the lifecycle rule can scope to them exclusively."
  }

  assert {
    condition = length([
      for s in jsondecode(aws_s3_bucket_policy.terraform_state.policy).Statement : s
      if s.Sid == "S3ServerAccessLogsPolicy"
      && s.Effect == "Allow"
      && try(s.Principal.Service, null) == "logging.s3.amazonaws.com"
      && try(s.Condition.ArnLike["aws:SourceArn"], null) == local.terraform_state_bucket_arn
      && try(s.Condition.StringEquals["aws:SourceAccount"], null) == var.expected_account_id
    ]) == 1
    error_message = "The state bucket policy must grant exactly one scoped s3:PutObject statement to logging.s3.amazonaws.com for self-logging, with no wildcard principal or resource."
  }

  assert {
    condition = length([
      for s in jsondecode(aws_s3_bucket_policy.terraform_state.policy).Statement : s
      if s.Sid == "DenyInsecureTransport" && s.Effect == "Deny"
    ]) == 1
    error_message = "The existing DenyInsecureTransport statement must remain unchanged after converting the policy source to jsonencode()."
  }

  assert {
    condition     = aws_s3_bucket_lifecycle_configuration.terraform_state.rule[0].filter[0].prefix == "access-logs/"
    error_message = "The state bucket's lifecycle rule must be scoped to the access-logs/ prefix only, so Terraform state objects can never be expired by it."
  }

  assert {
    condition     = aws_s3_bucket_lifecycle_configuration.terraform_state.rule[0].expiration[0].days == var.access_log_expiration_days
    error_message = "The state bucket's access-log objects must expire after access_log_expiration_days."
  }
}
