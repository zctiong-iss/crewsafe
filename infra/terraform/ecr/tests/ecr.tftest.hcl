# Author: Jemilin Beulah
#
# Tests for the ecr-shared-dev component. Everything runs against a mocked
# provider, so no real AWS account or network call is involved. iam_boundary
# is the important one — the whole point of this component is that the push
# role can touch exactly one repository and nothing else.

mock_provider "aws" {}

# The mock fabricates a random account id, which would trip the repository's
# account precondition. Pin it here; rejects_mismatched_account varies
# expected_account_id against this to prove the precondition still fires.
override_data {
  target = data.aws_caller_identity.current
  values = { account_id = "123456789012" }
}

override_resource {
  target = aws_ecr_repository.backend
  values = {
    arn            = "arn:aws:ecr:ap-southeast-1:123456789012:repository/crewsafe/backend"
    repository_url = "123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/crewsafe/backend"
  }
}

override_resource {
  target = aws_iam_role.ecr_push
  values = {
    arn = "arn:aws:iam::123456789012:role/crewsafe-shared-dev-ecr-push"
  }
}

variables {
  expected_account_id      = "123456789012"
  account_alias            = "shared-dev"
  aws_region               = "ap-southeast-1"
  github_oidc_main_subject = "repo:owner@267492605/crewsafe@1310783821:ref:refs/heads/main"
}

# ---------------------------------------------------------------------------
# Input validation — every dispatch input is untrusted.
# ---------------------------------------------------------------------------

run "rejects_malformed_account_id" {
  command = plan
  variables {
    expected_account_id = "12345"
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
    account_alias = "Not_An_Alias"
  }
  expect_failures = [var.account_alias]
}

# A subject without the immutable owner/repository IDs would let a repository
# rename or transfer silently re-target the trust condition.
run "rejects_legacy_name_only_oidc_subject" {
  command = plan
  variables {
    github_oidc_main_subject = "repo:owner/crewsafe:ref:refs/heads/main"
  }
  expect_failures = [var.github_oidc_main_subject]
}

run "rejects_non_main_ref_oidc_subject" {
  command = plan
  variables {
    github_oidc_main_subject = "repo:owner@267492605/crewsafe@1310783821:ref:refs/heads/feature-x"
  }
  expect_failures = [var.github_oidc_main_subject]
}

# ---------------------------------------------------------------------------
# The registry itself
#
# These use `command = apply` since overrides aren't surfaced during plan on
# this Terraform version. A mocked apply creates nothing, just resolves
# computed values so the assertions have something to check.
# ---------------------------------------------------------------------------

run "entry_shape" {
  command = apply

  assert {
    condition     = aws_ecr_repository.backend.name == "crewsafe/backend"
    error_message = "The repository must be named crewsafe/backend, or the secrets component's existing crewsafe/* pull grant stops covering it."
  }

  assert {
    condition     = aws_ecr_repository.backend.image_scanning_configuration[0].scan_on_push == true
    error_message = "Every pushed image must be scanned."
  }

  assert {
    condition     = aws_ecr_repository.backend.image_tag_mutability == "IMMUTABLE"
    error_message = "Tags must be immutable, or a pushed image can be silently replaced (AWS-0031)."
  }

  assert {
    condition     = length(jsondecode(aws_ecr_lifecycle_policy.backend.policy).rules) == 2
    error_message = "The lifecycle policy's rule count changed — review the retention/expiry behavior before accepting."
  }

  assert {
    condition = anytrue([
      for r in jsondecode(aws_ecr_lifecycle_policy.backend.policy).rules :
      r.selection.tagStatus == "untagged" && r.action.type == "expire"
    ])
    error_message = "Untagged images (left behind by a failed or partial push) must expire."
  }
}

# A dispatch against an account other than the designated one must fail before
# anything is created.
run "rejects_mismatched_account" {
  command = plan

  variables {
    expected_account_id = "999999999999"
  }

  expect_failures = [aws_ecr_repository.backend]
}

# ---------------------------------------------------------------------------
# The push identity's permission boundary — the load-bearing controls.
# ---------------------------------------------------------------------------

run "iam_boundary" {
  command = apply

  # Every statement's resource is either the exact repository ARN or the one
  # documented registry-level wildcard below — never a broader pattern.
  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role_policy.ecr_push.policy).Statement :
      s.Resource == aws_ecr_repository.backend.arn || s.Resource == "*"
    ])
    error_message = "A statement's resource is neither the exact repository ARN nor the documented registry-level wildcard."
  }

  # Exactly one statement uses the full wildcard, and it is the one action AWS
  # gives no resource-level permission for.
  assert {
    condition = length([
      for s in jsondecode(aws_iam_role_policy.ecr_push.policy).Statement : s.Sid
      if s.Resource == "*"
    ]) == 1
    error_message = "There must be exactly one statement using a full resource wildcard."
  }

  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role_policy.ecr_push.policy).Statement :
      length(s.Action) == 1 && s.Action[0] == "ecr:GetAuthorizationToken"
      if s.Resource == "*"
    ])
    error_message = "The single wildcard statement must hold exactly one action, and it must be ecr:GetAuthorizationToken."
  }

  # The role must trust only the GitHub OIDC federated principal pinned to this
  # repository's main branch — no wildcard principal, no AWS account principal.
  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role.ecr_push.assume_role_policy).Statement :
      try(s.Principal.Federated, null) == "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
      && try(s.Principal.AWS, null) == null
      && s.Effect == "Allow"
      && try(s.Condition.StringEquals["token.actions.githubusercontent.com:sub"], null) == var.github_oidc_main_subject
      && try(s.Condition.StringEquals["token.actions.githubusercontent.com:aud"], null) == "sts.amazonaws.com"
    ])
    error_message = "The push role must trust only the OIDC federated principal, pinned to this repository's main-branch subject."
  }

  assert {
    condition     = startswith(aws_iam_role.ecr_push.name, "crewsafe-shared-dev-")
    error_message = "The push role must sit in the crewsafe-shared-dev-* naming scope the shared apply role's IAM boundary is written against."
  }

  # Every statement carries a Sid so a reviewer can name what they are reading.
  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role_policy.ecr_push.policy).Statement : try(s.Sid, "") != ""
    ])
    error_message = "Every policy statement must carry a Sid."
  }
}

# ---------------------------------------------------------------------------
# The producer contract — SCRUM-176's compute component and the backend CI
# workflow bind to these output names, never to internal resource addresses.
# ---------------------------------------------------------------------------

run "producer_contract" {
  command = apply

  assert {
    condition     = output.repository_url == aws_ecr_repository.backend.repository_url
    error_message = "repository_url must expose the repository's pull/push URL."
  }

  assert {
    condition     = output.repository_arn == aws_ecr_repository.backend.arn
    error_message = "repository_arn must expose the repository's ARN."
  }

  assert {
    condition     = output.push_role_arn == aws_iam_role.ecr_push.arn
    error_message = "push_role_arn must expose the push role's ARN."
  }

  # No output may carry a credential — every one is an identifier, a path, or a
  # registry URL.
  assert {
    condition = alltrue([
      for v in [output.repository_arn, output.push_role_arn] : startswith(v, "arn:aws:")
    ])
    error_message = "repository_arn and push_role_arn must be ARNs."
  }

  assert {
    condition     = length(regexall("^[0-9]{12}\\.dkr\\.ecr\\.", output.repository_url)) == 1
    error_message = "repository_url must be a registry URL, not a credential or an arbitrary string."
  }
}
