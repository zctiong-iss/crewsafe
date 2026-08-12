# SCRUM-272 — Post-deployment staging smoke tests

## Decision

After each successful backend or web `main` staging deployment, the release workflow
invokes one reusable, read-only GitHub Actions smoke workflow. The smoke job consumes the
exact revision emitted by the deployment job: the backend's selected immutable image tag
(including approved manual redeploys), or the web job's checked-out `GITHUB_SHA`.

The reusable workflow validates the approved HTTPS origins and authenticates a synthetic
worker through the existing shared-dev Cognito CLI public client using unsigned
`InitiateAuth`. It checks deployment surface availability, backend readiness, the
protected `/api/v1/me` identity/site-membership path, and a seeded read-only
current/next-shift plus stored-site-weather path. No application endpoint, migration,
database entity, Terraform component, or AWS permission is added.

## Workflow and security contract

`.github/workflows/staging-smoke.yml` has `workflow_call`, `contents: read`, pinned
actions, a five-minute timeout, and one explicitly mapped
`SMOKE_SYNTHETIC_WORKER_PASSWORD` secret. It has no `id-token: write`, static AWS
credentials, `secrets: inherit`, arbitrary URL inputs, production target, or automatic
rollback. Backend and web callers depend on `deploy-staging`, require its result to be
`success`, and pass `needs.deploy-staging.outputs.deployed_revision` as `trigger_sha`.

`.github/scripts/smoke/validate-staging-smoke-contract.sh` rejects missing or malformed
configuration, non-HTTPS/query-bearing/arbitrary/production-looking origins, invalid
UUIDs, non-synthetic usernames, and malformed shared Cognito JSON before requests begin.
`.github/scripts/smoke/run-staging-smoke.sh` keeps response bodies, headers, tokens,
cookies, and passwords in private temporary files, bounds each request to 15 seconds,
allows at most one transient transport/5xx retry, validates response shape, and fails
closed on every unusable result.

Evidence is a sanitized `SmokeRunEvidence` JSON artifact retained for seven days plus a
textual step summary. It contains only component, exact revision, approved hostnames,
check outcomes, bounded categories/statuses, timestamps, safe run links, and the
SCRUM-272 runbook path. Upload is attempted with `if: always()` and missing evidence is
an error, so evidence failure cannot turn verification failure into success.

## Test-first evidence

`.github/scripts/tests/test-staging-smoke.sh` provides deterministic `curl` and AWS CLI
stubs and runtime-generated synthetic values. Structural and mutation assertions cover
workflow ordering, revision propagation, permissions, action pinning, and secret
mapping. Runtime cases cover healthy verification, malformed configuration, redirects,
unauthorized responses, malformed shapes, timeout, transient retry, critical-workflow
failure, read-only request methods, redacted evidence, and runbook requirements.

The local suite never contacts staging, runs Terraform, or uses a developer AWS session:

```bash
.github/scripts/tests/test-staging-smoke.sh
```

Repository CI guard suites remain required. Post-merge acceptance evidence includes ten
healthy synthetic runs and deployment-completion/smoke-start/smoke-completion timestamps
to verify the 60-second start target, five-minute completion bound, exact revision, and
safe run links.

## Constitution compliance

The feature preserves server-side authorization and the deterministic safety boundary:
smoke tests use only existing protected read paths and seeded synthetic data, and never
mutate operational records. Credentials and raw upstream content are excluded from
source, logs, summaries, artifacts, and runbook examples. Tests precede implementation,
failure states are textual and actionable, reliability limits are explicit, and recovery
uses the reviewed SCRUM-271 deployment path with human approval. No ADR is required.

Operational triage, reviewed rollback, escalation, and recovery verification are defined
in [`SCRUM-272-staging-smoke-tests.md`](../runbooks/SCRUM-272-staging-smoke-tests.md).
