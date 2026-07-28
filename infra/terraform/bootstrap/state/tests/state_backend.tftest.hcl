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
