# SCRUM-242 — Staging web CORS origin plan

## Purpose

Replace the staging backend's localhost browser-origin allowlist with the deployed web origin:

```text
https://d3b75ru76gta2n.cloudfront.net
```

## Scope and safeguards

- Change only `infra/terraform/compute`'s existing non-secret CORS SSM parameter default.
- Preserve the existing wildcard rejection and add exact-origin/no-localhost Terraform assertions.
- Add Spring MockMvc positive and negative preflight coverage for `/api/v1/me`.
- Keep server-side Cognito authentication and site/object authorization unchanged; CORS is a
  browser allowlist, not authorization.
- Run Terraform only through reviewed CI. Do not directly edit SSM, register a task definition,
  or invoke ECS from SCRUM-242.

## Release order

1. SCRUM-271 is the completed deployment prerequisite. Its `Backend CI` workflow and
   `deploy-staging` job are the sole release mechanism.
2. Merge the approved SCRUM-242 change and run/review the CI Terraform plan and apply for
   `compute-shared-dev`.
3. After the apply, manually dispatch existing `Backend CI` with `publish=true` from the exact
   approved `main` commit. A pre-apply push-triggered run is not rollout evidence.
4. Record the CI run IDs, commit, image digest, allowed and denied preflights, authenticated API
   check, health check, end-to-end p95 timing summaries, and final no-change plan in
   `docs/runbooks/SCRUM-176-backend-compute-runtime.md`.

## Validation

- `cd backend && ./mvnw verify`
- Compute source, CI, and staging-deployment workflow guards
- Terraform fmt/validate/test and plan/apply evidence in CI only
- At least 20 redacted end-to-end allowed-preflight samples and 20 authenticated API-read samples;
  each p95 must be below one second.

## Constitution compliance

The change maintains an exact deny-by-default CORS allowlist, includes a negative origin test,
does not introduce credentials or user-data changes, preserves deterministic safety policy and
server-side authorization, and requires reviewed CI evidence before staging rollout.
