# SCRUM-271 — Automated staging release deployment

Backend releases are deployed from `backend-ci.yml` only after the main-branch image publisher
completes. The workflow verifies that the commit-SHA tag resolves to the recorded digest, registers
that digest for the existing backend task-definition family, and fails if ECS reports a failed or
rolled-back rollout.

Web releases are deployed from `web-ci.yml` only after its build/test job succeeds. The job rebuilds
the exact commit, syncs `web/dist` to the SCRUM-298 bucket with `--delete`, then requests `/*`
CloudFront invalidation. A failed sync or invalidation is a failed promotion. `web-sync.yml` remains
the manual recovery path: dispatch it on `main` with a known-good 40-character commit SHA.

## One-time CI configuration

After a reviewed CI Terraform apply of `compute-shared-dev`, set these non-secret repository
variables from the outputs: `CREWSAFE_BACKEND_DEPLOY_ROLE_ARN`,
`CREWSAFE_BACKEND_ECS_CLUSTER_NAME`, and `CREWSAFE_BACKEND_ECS_SERVICE_NAME`. Never use a Terraform
plan/apply role, a local AWS CLI session, or static keys to deploy.

## Evidence and limitation

Record the workflow run URL, commit SHA, backend image digest/task definition or web bucket/
invalidation ID. Do not copy tokens, state, or credentials. During Sprint 2, scanner/DAST findings
remain visible but some are report-only; SCRUM-146 owns the enforcement flip. Do not describe a
release as scan-approved until that work is complete.
