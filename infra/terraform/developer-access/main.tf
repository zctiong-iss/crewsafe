data "aws_caller_identity" "current" {}

locals {
  group_name = "crewsafe-developers"
  user_path  = "/crewsafe/developers/"

  # Reversed 2026-08-14 (research.md R-002 second amendment, explicit user instruction
  # after four rounds of live console testing each surfacing a missing service — RDS
  # clusters, ECR, S3, CloudFront/ELB — each costing a full commit/PR/merge/apply cycle
  # mid-test). The originally-approved design (Context, Out of Scope) deliberately
  # avoided AWS's managed ReadOnlyAccess/ViewOnlyAccess policies as "too broad, not
  # project-scoped". That decision is reversed here: this group now attaches the
  # AWS-managed job-function/ViewOnlyAccess policy instead of a hand-authored inline one.
  #
  # ViewOnlyAccess is AWS's own curated list of List/Describe/Get actions that exclude
  # resource content and secret values — it does not grant secretsmanager:GetSecretValue,
  # s3:GetObject, ssm:GetParameter on SecureString, or any write/mutate action anywhere.
  # FR-005's guarantee still holds; what changes is who curates and tests it. This
  # repository's own `terraform test` suite can no longer assert the exact action list
  # the way it did for a hand-authored policy (R-009's mocked-provider limitation applies
  # to AWS managed policy content too — we don't own it, so there's nothing local to
  # decode and assert against). The test suite now checks that this exact, well-known
  # managed policy ARN is attached and that no other custom policy grants anything
  # beyond it — trusting AWS's own curation and documentation for the policy's contents,
  # not re-deriving that guarantee locally.
  view_only_access_policy_arn = "arn:aws:iam::aws:policy/job-function/ViewOnlyAccess"
}

resource "aws_iam_group" "developers" {
  name = local.group_name
}

resource "aws_iam_group_policy_attachment" "developers_view_only" {
  group      = aws_iam_group.developers.name
  policy_arn = local.view_only_access_policy_arn
}

resource "aws_iam_user" "developer" {
  for_each = { for d in var.developers : d.username => d }

  name = each.value.username
  path = local.user_path
}

resource "aws_iam_user_login_profile" "developer" {
  for_each = aws_iam_user.developer

  user                    = each.value.name
  password_reset_required = true
  password_length         = 20
}

resource "aws_iam_access_key" "developer" {
  for_each = aws_iam_user.developer

  user = each.value.name
}

resource "aws_iam_user_group_membership" "developer" {
  for_each = aws_iam_user.developer

  user   = each.value.name
  groups = [aws_iam_group.developers.name]
}

resource "terraform_data" "input_validation" {
  input = {
    expected_account_id = var.expected_account_id
    account_alias       = var.account_alias
  }

  lifecycle {
    precondition {
      condition     = data.aws_caller_identity.current.account_id == var.expected_account_id
      error_message = "Authenticated AWS account does not match expected_account_id."
    }
  }
}
