# Infrastructure tests for the crewsafe shared-dev developer read-only IAM access
# component (SCRUM-372).
#
# Every run block plans against a mocked provider, so no AWS account, credential, or
# network call is involved. The policy-content assertions in the "developer_read_only_policy"
# run block are the load-bearing controls: this component's entire purpose is that every
# developer identity can read exactly the listed resources and nothing else, and a widened
# action or an accidentally granted `secretsmanager:GetSecretValue` is the single most likely
# regression in an IAM policy (research.md R-009).
#
# The IAM assertions decode the policy JSON actually attached to the group, not a local in
# isolation — read via the resource's `policy` attribute after `jsonencode()`, which works
# under a mocked provider only because the policy is built from a `local`, never a rendered
# `data "aws_iam_policy_document"`, whose `json` attribute the mock would fabricate (R-009,
# reused from secrets-and-iam's own R-004 finding).

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

# --- User Story 1: policy content (T011) ----------------------------------------------
# The acceptance test for SC-002: every statement's actions are a subset of an explicit
# read-verb allow-list, and secretsmanager:GetSecretValue is granted nowhere. Decodes the
# actual attached policy JSON, not local.read_only_policy directly (R-009) — command=apply
# so the resource's real `policy` attribute is available to assert against.

run "developer_read_only_policy" {
  command = apply

  variables {
    developers = [{ username = "alice" }]
  }

  assert {
    condition = alltrue([
      for stmt in jsondecode(aws_iam_group_policy.developers_read_only.policy).Statement :
      alltrue([
        for action in stmt.Action :
        anytrue([
          startswith(action, "ecs:List"),
          startswith(action, "ecs:Describe"),
          action == "rds:DescribeDBInstances",
          startswith(action, "ec2:Describe"),
          action == "logs:DescribeLogGroups",
          action == "logs:GetLogEvents",
          action == "logs:FilterLogEvents",
          action == "secretsmanager:ListSecrets",
          action == "secretsmanager:DescribeSecret",
        ])
      ])
    ])
    error_message = "developers_read_only policy grants an action outside the read-only allow-list (SC-002)."
  }

  assert {
    condition = !contains(
      flatten([
        for stmt in jsondecode(aws_iam_group_policy.developers_read_only.policy).Statement :
        stmt.Action
      ]),
      "secretsmanager:GetSecretValue"
    )
    error_message = "developers_read_only policy must never grant secretsmanager:GetSecretValue (FR-005)."
  }

  assert {
    condition = [
      for stmt in jsondecode(aws_iam_group_policy.developers_read_only.policy).Statement :
      stmt.Resource if stmt.Sid == "ListLogGroups"
    ][0] == "*"
    error_message = "logs:DescribeLogGroups must be scoped to Resource \"*\" — it accepts no resource scope (SCRUM-175 lesson)."
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
