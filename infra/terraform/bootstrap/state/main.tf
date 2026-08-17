data "aws_caller_identity" "current" {}

locals {
  state_bucket_name = "crewsafe-terraform-state-${data.aws_caller_identity.current.account_id}-${var.aws_region}"
  common_tags = {
    Project           = "CrewSafe"
    ManagedBy         = "Terraform"
    DeploymentAccount = var.account_alias
  }
}

resource "aws_s3_bucket" "terraform_state" {
  bucket        = local.state_bucket_name
  force_destroy = false
  tags          = local.common_tags

  lifecycle {
    prevent_destroy = true

    precondition {
      condition     = data.aws_caller_identity.current.account_id == var.expected_account_id
      error_message = "Authenticated AWS account does not match expected_account_id."
    }
  }
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  versioning_configuration {
    status = "Enabled"
  }
}

# SCRUM-155 deliberately uses AWS-managed SSE-S3 (AES256) to avoid a
# cross-service KMS dependency in the state-backend bootstrap root.
#trivy:ignore:AWS-0132
resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }

    bucket_key_enabled = false
  }
}

resource "aws_s3_bucket_ownership_controls" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# jsonencode(), not data "aws_iam_policy_document" — mock_provider "aws" fabricates
# a random opaque string for that data source's .json attribute under `terraform
# test`'s command = plan, which makes it unknown at plan time and unassertable
# (research.md R-008 in specs/046-terraform-access-logging-remediation). Mirrors
# the compute component's own local.web_logs_bucket_policy pattern (SCRUM-414).
locals {
  terraform_state_bucket_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = ["s3:*"]
        Resource = [
          aws_s3_bucket.terraform_state.arn,
          "${aws_s3_bucket.terraform_state.arn}/*",
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      },
      {
        Sid       = "S3ServerAccessLogsPolicy"
        Effect    = "Allow"
        Action    = ["s3:PutObject"]
        Resource  = "${aws_s3_bucket.terraform_state.arn}/access-logs/*"
        Principal = { Service = "logging.s3.amazonaws.com" }
        Condition = {
          ArnLike = {
            "aws:SourceArn" = aws_s3_bucket.terraform_state.arn
          }
          StringEquals = {
            "aws:SourceAccount" = var.expected_account_id
          }
        }
      },
    ]
  })
}

resource "aws_s3_bucket_policy" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  policy = local.terraform_state_bucket_policy

  depends_on = [aws_s3_bucket_public_access_block.terraform_state]
}

# SCRUM-443, terraform:S6258 — the state bucket had no access logging. Self-
# logging (target == source) closes the gap without a second bucket in this
# foundational, single-bucket root module, mirroring the compute component's
# own web_logs self-logging precedent (SCRUM-414). The lifecycle rule's filter
# is scoped exclusively to the access-logs/ prefix so it can never expire a
# Terraform state object, which never uses that prefix.
resource "aws_s3_bucket_lifecycle_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    id     = "expire-access-logs"
    status = "Enabled"

    filter {
      prefix = "access-logs/"
    }

    expiration {
      days = var.access_log_expiration_days
    }
  }
}

resource "aws_s3_bucket_logging" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  target_bucket = aws_s3_bucket.terraform_state.id
  target_prefix = "access-logs/"
}
