# Implementation Plan: Web Image ECR Registry

**Jira**: SCRUM-253 (subtask of SCRUM-142) · **Reference**: SCRUM-192 · **Branch**:
`feat/scrum-253-ecr-registry-web` · **Date**: 2026-08-05

## Scope

Extend the existing `ecr-shared-dev` Terraform component with the infrastructure contract for
the future web image. This change creates `crewsafe/web`, its lifecycle policy, a dedicated
GitHub Actions OIDC publication role, and the role's inline push policy. It adds stable outputs
for a follow-up web workflow and runtime consumer.

The web frontend, Dockerfile, image build, image publication workflow, deployment runtime, and
runtime pull role are explicitly out of scope. They are follow-up work and must consume the
outputs and contracts defined here.

## Design and compatibility

- Keep the existing component root `infra/terraform/ecr`, catalog key `ecr-shared-dev`, state key
  `crewsafe/ecr/shared-dev.tfstate`, and `allow_destroy: false` unchanged.
- Preserve the existing backend resource addresses, outputs, role, trust, and repository scope.
- Add exactly four managed resources: the web ECR repository, web lifecycle policy, dedicated web
  OIDC role, and web inline push policy.
- Use `crewsafe/web`, immutable tags, scan-on-push, one-day untagged-image expiry, and newest-20
  retention, matching the SCRUM-192 baseline.
- Trust only the validated immutable owner/repository `main` subject and
  `sts.amazonaws.com`; no wildcard subject, branch, or principal is allowed.
- Scope web push actions to the exact web repository ARN. The only `*` resource is the one-action
  `ecr:GetAuthorizationToken` statement required by AWS.

## Output contract

| Output | Consumer |
| --- | --- |
| `web_repository_url` | Future web publication and deployment configuration |
| `web_repository_arn` | Future runtime pull policy, scoped to this repository |
| `web_push_role_arn` | Future web workflow's short-lived OIDC assumption |

Existing `repository_url`, `repository_arn`, and `push_role_arn` outputs remain unchanged for the
backend and SCRUM-192/SCRUM-176 consumers.

## Test and review evidence

Tests are ordered before implementation and cover repository shape, account preconditions,
immutable tags, scan-on-push, lifecycle rules, output identity, OIDC trust, non-main/legacy
subject rejection, exact IAM resource scope, and backend preservation. The source guard also
checks the catalog/state boundary, manual IAM policy scopes, and the pull-only follow-up contract.

Terraform formatting, validation, mocked tests, and plan review are CI-only. The expected reviewed
state delta from the applied SCRUM-192 baseline is `4 to add, 0 to change, 0 to destroy`.

## Constitution and operational constraints

The design stays within the approved AWS/Terraform/GitHub OIDC stack, adds no secrets or state,
keeps authorization least-privilege and server-side, preserves remote state and destroy
protection, and does not change application safety policy or UI behavior. No Terraform command,
AWS mutation, local state, or saved plan is permitted on a workstation.
