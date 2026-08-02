# ADR 0007 — Container registry: ECR over GHCR

**Status:** Accepted
**Date:** 2026-08-02
**Jira:** SCRUM-177
**Author:** Jemilin Beulah

## Context

SCRUM-177 requires the backend CI pipeline to publish a tagged, pullable
container image on `main`. SCRUM-176 (the backend compute runtime — ECS
Fargate or App Runner, still unstarted) is the consumer. Two registries were
viable: GitHub Container Registry (GHCR) and Amazon ECR.

## Decision

Publish to ECR, as a new Terraform component (`ecr-shared-dev`) following this
repo's existing per-component convention (see `infra/terraform/{network,
secrets,cognito}`), with its own GitHub OIDC image-push role independent of the
existing `CREWSAFE_AWS_ACCOUNTS_JSON` plan/apply roles.

SCRUM-176's compute runtime will run in AWS. The `secrets-shared-dev` component
already grants its ECS task-execution role `ecr:BatchCheckLayerAvailability`,
`ecr:BatchGetImage`, and `ecr:GetDownloadUrlForLayer` scoped to
`arn:aws:ecr:<region>:<account>:repository/crewsafe/*` — a pull grant that sits
unused until an image under that prefix exists. ECR uses it directly; GHCR
would require SCRUM-176 to instead solve cross-registry pull authentication
(a GitHub PAT or App token stored as an AWS secret and refreshed) for a
consumer that has no reason to reach outside AWS in the first place.

## Consequences

- A new Terraform component and one new IAM role (`crewsafe-shared-dev-ecr-push`)
  to review and operate, in addition to the CI workflow itself.
- A new GitHub OIDC trust subject, registered as its own repository variable
  (`CREWSAFE_ECR_PUSH_ROLE_ARN`) rather than inside `CREWSAFE_AWS_ACCOUNTS_JSON`
  — that schema is closed and scoped to Terraform state management only
  (`resolve-terraform-account.sh` validates exactly `plan_role_arn` and
  `apply_role_arn`); conflating a CI image-push identity into it would widen
  the blast radius of an unrelated schema.
- No cross-registry credential to manage, rotate, or leak.

## Alternatives rejected

- **GHCR.** Adds a second, cross-registry authentication path for SCRUM-176's
  pull with no corresponding benefit — nothing outside AWS ever needs to reach
  this image.
- **Reusing `plan_role_arn` or `apply_role_arn` for image push.** Both are
  Terraform state-management identities. Attaching `ecr:PutImage` to either
  would let a compromised or misconfigured Terraform run push arbitrary image
  content, and would let a compromised image-push step reach Terraform state —
  two unrelated blast radii merged into one.
