# Implementation Plan: Build and Push Web Image

**Jira:** SCRUM-257  
**Branch:** `feat/scrum-257-build-push-web-image`  
**Upstream:** SCRUM-253 web ECR registry

## Scope

Modify the existing `.github/workflows/web-ci.yml` to follow the approved
`backend-ci.yml` shape. The workflow keeps a validation-only `build-test` job and adds a
gated `publish-image` job for the web image. It builds a digest-pinned static container,
blocks on high/critical Trivy findings, assumes the dedicated SCRUM-253 web ECR role by
GitHub OIDC, and publishes exactly one commit-SHA tag to `crewsafe/web`.

## Workflow contract

Validation runs for pull requests targeting `main`, pushes to `main`, and manual dispatch.
It checks out the exact revision and runs, in order, `npm ci`, lint, type-check, unit tests,
and the production build from `web/`. It has no AWS credentials or publication permission.

Publication requires successful validation and runs only when the ref is `main` and the
event is a push or a manual dispatch with `publish=true`. Missing repository variables fail
visibly in the publication job before image build/authentication. The job uses
`contents: read` and `id-token: write` only, validates the exact web repository and role,
scans before push, records the URI/tag/digest as outputs and in the run summary, and never
uses static credentials, `latest`, backend ECR variables, or deployment commands.

Required repository variables:

- `CREWSAFE_WEB_ECR_REPOSITORY_URL`, the regional twelve-digit ECR URL ending in
  `/crewsafe/web`.
- `CREWSAFE_WEB_ECR_PUSH_ROLE_ARN`, the twelve-digit AWS ARN for the dedicated
  `crewsafe-shared-dev-ecr-web-push` role.

## Durable files

| File | Purpose |
|---|---|
| `.github/workflows/web-ci.yml` | Backend-shaped validation and gated publication. |
| `.github/scripts/tests/test-frontend-ci-guards.sh` | Shared web/mobile boundary checks. |
| `.github/scripts/tests/test-web-image-workflow.sh` | Web image workflow/container guard checks and negative fixtures. |
| `web/Dockerfile`, `web/.dockerignore`, `web/nginx.conf` | Digest-pinned build and unprivileged static runtime. |
| `docs/adr/0014-web-static-container-runtime.md` | Runtime image decision and rejected alternatives. |
| `docs/runbooks/SCRUM-257-build-push-web-image.md` | Operator setup, recovery, and evidence ledger. |
| `sonar-project.properties` | Includes the new container and Nginx configuration in SAST scope. |

## Constitution compliance

The change uses tests before implementation, adds no secrets or Terraform state, does not
run Terraform or mutate AWS locally, keeps authorization in the dedicated OIDC role and
workflow predicate, preserves deterministic fail-closed behaviour, and excludes
`specs/**` from production artifacts. Deployment rollout and runtime image-pull tests are
out of scope.

## Validation evidence

Required evidence is the two local guard scripts, actionlint/shellcheck, the web npm test
sequence, a local Docker build and blocking Trivy scan, repository security/configuration
checks, and at least 20 representative workflow runs for the 15-minute/90% reliability
target. Record sanitized run IDs/URLs and results in the runbook; never record credentials,
tokens, or secret-bearing logs.
