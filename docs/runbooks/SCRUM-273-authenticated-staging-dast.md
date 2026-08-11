# SCRUM-273 — Authenticated staging DAST

## Scope and prerequisites

The DAST workflow runs only after a successful `main` staging web or backend deployment.
It scans the reviewed HTTPS web and backend origins using a dedicated synthetic worker
identity. Cognito Hosted UI is used only for browser authentication and is never a
spider or active-scan target.

Before the first scan, an authorized repository maintainer must configure the reviewed
`DAST_SYNTHETIC_WORKER_PASSWORD` GitHub secret and the non-secret synthetic username
variable. They must also configure the independent
`CREWSAFE_DAST_APPROVED_WEB_BASE_URL` and
`CREWSAFE_DAST_APPROVED_BACKEND_BASE_URL` repository variables to exactly match the
reviewed staging origins. The identity must be active, staging-only, and have the
minimum worker role and site membership needed to complete the approved read-only
journey. Do not use a human, administrator, deployment, AWS, or production identity.

Never record a username, password, Cognito subject, OAuth code, token, cookie, request
body, response body, raw scanner report, or query string in this runbook, Jira, pull
request, or CI summary.

## Safety boundary

- Only the reviewed web and backend CloudFront HTTPS origins are scan targets.
- The exact Cognito Hosted UI hostname is authentication-only.
- The SPA uses Cognito bearer tokens for backend calls. ZAP keeps that token in
  header-based session management and verifies the protected `/api/v1/me` endpoint
  once per second; do not set the poll frequency to zero because ZAP reports that as
  a warning-only plan result. No token or cookie is written to CI output.
- The active scanner permits GET/HEAD only. POST, PUT, PATCH, DELETE, and operational,
  logout, approval, decision, acknowledgement, completion, readiness, wellbeing,
  concern, mitigation, assignment, and cancellation probes are rewritten to a
  bodyless HEAD request by the last-line guard; the original method and payload are
  never sent. Redirects to out-of-scope hosts are rewritten as bodyless HEAD requests
  to the reviewed web origin's dedicated sink path; the original host is never
  contacted.
- Report generation always runs against the mounted ephemeral output directory, even
  when an earlier scan step records an error. A non-zero ZAP exit remains an unavailable
  security-control result; the report is retained only for the wrapper's in-job review.
- On a non-zero scan exit, the wrapper checks the ephemeral ZAP internal log as well as
  scanner output and prints at most one bounded, redacted diagnostic. Only the log file
  is mounted from the runner; raw logs and all other ZAP runtime state remain ephemeral
  and disappear with the container when the job exits.
- Target, policy, identity, scanner, or authentication validation failures are failed
  security-control states. Do not relabel them as a clean scan and do not bypass them
  with a workstation procedure.

## Review and triage

The job summary is advisory and shows only the triggering release, approved hostnames,
scanner policy/image identifier, duration, and severity counts. A suspected finding is
not a validated vulnerability and does not block the deployment already completed.

1. Preserve the GitHub run URL and sanitized summary.
2. Validate the finding without copying raw scanner traffic into issue trackers.
3. Record the disposition as validated, false-positive, remediated-and-retested, or a
   reviewed time-bounded exception.
4. Retest through the normal CI path after remediation.
5. Escalate promotion-blocking design and enforcement to **SCRUM-297** only after
   initial findings have been triaged. Do not silently turn this advisory workflow into
   a release gate.

## Recovery

If preflight, authentication, scanner startup, or report generation fails, the job is
an unavailable security-control result. Preserve the run URL and redacted message,
correct reviewed configuration through a pull request or approved secret-management
path, then obtain a fresh scan through a normal staging deployment. Do not rerun the
scanner locally or scan an unapproved target.

## First post-merge validation

After merge, an authorized maintainer should await or trigger one ordinary staging
deployment. Confirm one DAST job follows it and captures both approved origins. Record
only the run URL, triggering commit, outcome, and redacted severity counts in the PR or
SCRUM-273. A successful run is evidence of coverage; a scanner/authentication failure
requires remediation and a new run.
