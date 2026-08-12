# SCRUM-272 — Post-deployment staging smoke tests

## Scope and prerequisites

The staging smoke workflow runs only after a successful `deploy-staging` job in the
backend or web release workflow. It verifies the exact deployed revision against the
approved staging origins using a synthetic worker and read-only requests. It is a
release gate, not an advisory scan and not a replacement for authenticated DAST.

Before enabling the gate, an authorized release maintainer must configure:

- `CREWSAFE_SMOKE_SITE_ID` with the seeded staging site's UUID;
- `CREWSAFE_SMOKE_SYNTHETIC_WORKER_USERNAME` with the synthetic worker username;
- `CREWSAFE_SHARED_COGNITO_JSON` with the reviewed shared-dev Cognito configuration;
- `CREWSAFE_SMOKE_SYNTHETIC_WORKER_PASSWORD` as a GitHub Actions secret;
- the existing approved web/backend origin variables, which must exactly match the
  deployed staging CloudFront origins.

The synthetic worker must be active, have the worker role, and be assigned to the
configured site with a current or upcoming seeded shift and stored weather. Never use
a human, administrator, production, deployment, or local AWS identity.

Do not record passwords, tokens, cookies, authorization headers, raw request or response
bodies, Cognito subjects, personal data, or query strings in this runbook, Jira, a pull
request, a CI summary, or an artifact.

## Check contract

The smoke summary and evidence use these textual check names:

1. `deployment_surface` — backend liveness for a backend deployment, or the approved
   web origin for a web deployment.
2. `service_readiness` — backend readiness returns HTTP 200 with status `UP`.
3. `authenticated_access` — the synthetic worker authenticates and `/api/v1/me`
   returns a valid worker identity containing the configured site membership.
4. `critical_workflow` — `/api/v1/shifts/me` returns a seeded current/next shift and
   `/api/v1/sites/{siteId}/weather/latest` returns stored conditions for that site.

Each request is read-only, has a 15-second bound, and can receive at most one
transient transport/5xx retry. Redirects, unauthorized responses, malformed shapes,
timeouts, unavailable targets, missing configuration, or revision mismatch are failed
states. There is no offline success mode and no cached success from an earlier revision.

## First triage owner

The **first triage owner is the release operator who started or is on call for the
deployment**. The owner must:

1. Open the failed smoke job and preserve only its GitHub run URL, component, exact
   deployed revision, failed check name, bounded category/status, and runbook link.
2. Confirm the preceding `deploy-staging` job completed successfully and that its
   `deployed_revision` output is the revision in the smoke summary.
3. Inspect the textual summary and sanitized short-retention artifact. Do not download,
   copy, or request raw response content.
4. Classify the first actionable failure as configuration, target availability,
   authentication/authorization, invalid shape, timeout, transport, server error,
   revision mismatch, or evidence failure.
5. Check the corresponding deployment and smoke job logs using the run links. Keep
   diagnostic notes bounded and redacted.

If the deployment was skipped, cancelled, failed, or rolled back, the smoke result
cannot be treated as a passing verification. Rerun the reviewed release path only after
the deployment condition is corrected.

## Recovery and Rollback

Smoke tests never mutate operational data and never perform automatic rollback.

If the deployed revision is unsafe to retain, the release operator escalates to the
**staging release owner** for approval. The staging release owner performs rollback
through the reviewed SCRUM-271 deployment path in `.github/workflows/backend-ci.yml` or
`.github/workflows/web-ci.yml`, using a reviewed main-branch revision or approved
backend ancestor image. Do not run Terraform, the deployment script, AWS CLI, or a
saved plan from a workstation, and do not edit ECS, S3, CloudFront, or the database by
hand.

### Recovery verification

After rollback or a corrected deployment:

1. Confirm the new deployment job succeeded and emitted a new exact revision.
2. Obtain a fresh smoke run for that revision; an earlier passing artifact cannot
   satisfy the new release.
3. Verify all four checks pass and the evidence records the new revision and run link.
4. Record the sanitized outcome and approval owner in the change review.

## Escalation

Escalate to the **CrewSafe platform/release owner** when the failure is not resolved
within the current deployment window, the deployment revision cannot be proven, the
staging target or Cognito dependency is unavailable, evidence upload fails, or rollback
approval is unclear. The hand-off must include only the component, revision, run links,
failed check, bounded category/status, timestamps, attempted recovery, and requested
decision. Do not ask for or attach secrets in Jira, Slack, email, or CI comments.

## Acceptance validation

After merge, an authorized maintainer should trigger a normal backend or web `main`
staging deployment and confirm exactly one smoke job follows the successful deployment.
For release evidence, execute ten repeated healthy synthetic verifications and record
the deployment completion, smoke-job start, and smoke completion timestamps. Confirm
each run starts within 60 seconds, completes within five minutes, records the exact
revision and safe run link, and contains no secret or raw response content.
