# Infrastructure tests for the crewsafe shared-dev developer read-only IAM access
# component (SCRUM-372).
#
# Every run block plans against a mocked provider, so no AWS account, credential, or
# network call is involved.
#
# Read access is granted via the AWS-managed job-function/ViewOnlyAccess policy, not a
# hand-authored inline one (research.md R-002, second amendment, 2026-08-14) — reversing
# the originally-approved decision after four rounds of live console testing each
# surfacing a missing service. This means the "developer_view_only_policy" run below can
# only assert that the correct, well-known managed policy ARN is attached — it cannot
# decode and assert the policy's actual contents the way the earlier hand-authored
# version could, because that content is AWS's, not this repository's, to own or fabricate
# under a mock (R-009's limitation applies here too). The guarantee that ViewOnlyAccess
# excludes secretsmanager:GetSecretValue and every write action is trusted from AWS's own
# curation and documentation, not re-derived locally.

mock_provider "aws" {}

# The mocked provider fabricates a random account id, which would trip this component's
# account precondition in every run. Pin it once here so each run exercises what it is
# actually about.
override_data {
  target = data.aws_caller_identity.current
  values = { account_id = "123456789012" }
}

variables {
  expected_account_id = "123456789012"
  account_alias       = "shared-dev"
  aws_region          = "ap-southeast-1"
  developers = [
    { username = "alice" },
    { username = "bob" },
  ]
}

# --- Input validation (T007) ---------------------------------------------------------
# Written before variables.tf gains its `validation` blocks (T008). Each of these five
# is expected to FAIL right now: nothing rejects bad input yet.

run "rejects_malformed_account_id" {
  command = plan
  variables {
    expected_account_id = "123"
  }
  expect_failures = [var.expected_account_id]
}

run "rejects_region_outside_ap_southeast_1" {
  command = plan
  variables {
    aws_region = "us-east-1"
  }
  expect_failures = [var.aws_region]
}

run "rejects_non_slug_account_alias" {
  command = plan
  variables {
    account_alias = "Shared_Dev!"
  }
  expect_failures = [var.account_alias]
}

run "rejects_username_outside_iam_charset" {
  command = plan
  variables {
    developers = [{ username = "alice bob" }]
  }
  expect_failures = [var.developers]
}

run "rejects_username_outside_slug_convention" {
  command = plan
  variables {
    developers = [{ username = "Alice" }]
  }
  expect_failures = [var.developers]
}

# --- User Story 1: policy attachment (T011, amended) ------------------------------------
# What's left to test locally after the R-002 second amendment: that the group attaches
# exactly the intended, well-known AWS-managed policy, to the intended group — not that
# policy's contents, which this repository doesn't author (see file header).

run "developer_view_only_policy" {
  command = apply

  variables {
    developers = [{ username = "alice" }]
  }

  assert {
    condition     = aws_iam_group_policy_attachment.developers_view_only.policy_arn == "arn:aws:iam::aws:policy/job-function/ViewOnlyAccess"
    error_message = "The developers group must attach exactly the AWS-managed job-function/ViewOnlyAccess policy — no other managed or inline policy grants read access here."
  }

  assert {
    condition     = aws_iam_group_policy_attachment.developers_view_only.group == aws_iam_group.developers.name
    error_message = "The ViewOnlyAccess attachment must target the crewsafe-developers group."
  }
}

# --- User Story 1: resource shapes (T012) ----------------------------------------------

run "developer_resource_shapes" {
  # apply, not plan: the prior run applied state with only "alice"; planning "bob" fresh
  # here left its computed attributes unknown at plan time, which made list-equality
  # comparisons involving them evaluate to unknown rather than a concrete boolean.
  command = apply

  assert {
    condition     = aws_iam_group.developers.name == "crewsafe-developers"
    error_message = "Developer group must be named crewsafe-developers."
  }

  assert {
    condition = alltrue([
      for k, u in aws_iam_user.developer : u.path == "/crewsafe/developers/"
    ])
    error_message = "Every developer IAM user must use the /crewsafe/developers/ path (R-004)."
  }

  assert {
    condition = alltrue([
      for k, p in aws_iam_user_login_profile.developer : p.password_reset_required == true
    ])
    error_message = "Every developer login profile must require a password reset at first sign-in (FR-002)."
  }

  assert {
    condition     = length(aws_iam_access_key.developer) == length(var.developers)
    error_message = "Every developer must have exactly one CLI access key (Clarifications, Q2)."
  }

  assert {
    condition = alltrue([
      for k, m in aws_iam_user_group_membership.developer :
      contains(m.groups, aws_iam_group.developers.name) && length(m.groups) == 1
    ])
    error_message = "Every developer must be a member of exactly the crewsafe-developers group."
  }
}

# --- User Story 2: onboarding (T026) ----------------------------------------------------
# Note on approach: native `terraform test` has no queryable "N resources planned to add"
# primitive — assertions can only read resource/output values, not the raw plan diff. The
# honest proof available is therefore: the new developer's resources exist with the right
# shape, and the pre-existing developers' identities are still present and unchanged. That
# existing entries in a for_each map are untouched by adding a new key is a structural
# guarantee of how Terraform addresses for_each instances, not something this test needs to
# independently reprove.

run "onboard_third_developer" {
  command = apply
  variables {
    developers = [
      { username = "alice" },
      { username = "bob" },
      { username = "carol" },
    ]
  }

  assert {
    condition     = length(aws_iam_user.developer) == 3
    error_message = "Onboarding must result in exactly three developer users (FR-006)."
  }

  assert {
    condition     = aws_iam_user.developer["carol"].path == "/crewsafe/developers/"
    error_message = "The newly onboarded developer must carry the same path as every other developer."
  }

  assert {
    condition     = aws_iam_user.developer["alice"].name == "alice" && aws_iam_user.developer["bob"].name == "bob"
    error_message = "Onboarding a third developer must not disturb the existing two (FR-006 — zero other resource changes)."
  }

  assert {
    condition     = aws_iam_group.developers.name == "crewsafe-developers"
    error_message = "Onboarding must not change the shared group (FR-006)."
  }
}

# --- User Story 3: offboarding (T029) ---------------------------------------------------
# Builds on the three-developer state the onboarding run above left behind. Removes "bob";
# proves that user's resources are gone while "alice" and "carol" are unaffected (FR-007).

run "offboard_one_developer" {
  command = apply
  variables {
    developers = [
      { username = "alice" },
      { username = "carol" },
    ]
  }

  assert {
    condition     = length(aws_iam_user.developer) == 2
    error_message = "Offboarding must result in exactly two developer users remaining (FR-007)."
  }

  assert {
    condition     = !contains(keys(aws_iam_user.developer), "bob")
    error_message = "The offboarded developer's user must no longer exist."
  }

  assert {
    condition     = aws_iam_user.developer["alice"].name == "alice" && aws_iam_user.developer["carol"].name == "carol"
    error_message = "Offboarding one developer must not disturb any other developer (FR-007 — zero other resource changes)."
  }

  assert {
    condition     = aws_iam_group.developers.name == "crewsafe-developers"
    error_message = "Offboarding must not change the shared group (FR-007)."
  }
}
