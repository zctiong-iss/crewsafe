# SCRUM-273 — Authenticated staging DAST

## Decision

After each successful main-branch web or backend staging deployment, a local reusable
workflow runs OWASP ZAP's Automation Framework from a pinned image digest. It uses a
dedicated synthetic worker through Cognito Hosted UI browser authentication, assesses
only the reviewed staging web and backend origins, and treats Cognito as
authentication-only.

The active scanner may issue only GET/HEAD requests to the reviewed origins. A ZAP HTTP
Sender guard rewrites an Active-Scanner request to any other host as a bodyless HEAD to
the reviewed web origin's dedicated sink path, and rewrites any other method to a
bodyless HEAD request. This keeps the Automation Framework from failing on a refused
discard socket while ensuring no out-of-scope host sees the original request, mutating
method, or payload. The guard does not interfere with the separate browser-login POST to
Cognito. Request bodies, cookies, and headers are not active-scan input vectors.
Operational and state-changing paths are excluded.

Because the SPA authenticates its backend calls with a Cognito bearer token rather than
a server session cookie, the context uses ZAP header-based session management and carries
the token returned by the browser code flow on scanner requests. Authentication is
verified by polling the protected `/api/v1/me` endpoint once per second; a zero poll
frequency is invalid in ZAP and produces a warning-only plan exit. The client spider
runs the browser-side application flow before the active scanner starts, so the scan
does not mistake the SPA shell or an unauthenticated API response for authenticated
coverage.

ZAP's Automation Framework does not reliably substitute `${ENV_VAR}` placeholders in
every field of the plan — `authentication.verification.pollUrl` is a documented gap
(zaproxy/zaproxy#8777, #7201) even though the identical syntax resolves correctly in
`context.urls` and `loginPageUrl`. Left unfixed, every login-verification poll silently
requests the literal unresolved string (`${BACKEND_BASE_URL}/api/v1/me`), which is not a
valid URI; ZAP never confirms the synthetic worker is logged in, the crawl and active scan
proceed unauthenticated, and the run's `insight.auth.failure` stat reaches 100%. The
wrapper resolves every `${WEB_BASE_URL}`/`${BACKEND_BASE_URL}`/`${HOSTED_UI_URL}`/
`${DAST_USERNAME}`/`${DAST_SYNTHETIC_WORKER_PASSWORD}` placeholder itself with `envsubst`
before ZAP ever reads the plan, and mounts only the resolved copy (alongside the guard
script, since its `source:` path resolves relative to the plan file) instead of the whole
workspace — so the scan can no longer run, undetected, against a broken poll URL.

The plan waits for the passive scanner to drain its background analysis queue after the
client spider and again after the active scanner, before the report job runs. The passive
scanner analyzes traffic asynchronously; without waiting, the report job can read the
alerts store while the passive scanner is still concurrently writing to it, producing an
incomplete or empty report even when the crawl and active scan otherwise succeeded.

The report job always runs and writes to the runner-mounted `/zap/dast-output` directory,
including when an earlier scan job records an error. A ZAP error exit makes the
security-control job unavailable; a warning exit remains advisory when a reviewable
report exists, matching the policy's `failOnWarning: false` setting. `alwaysRun` preserves
evidence and does not turn a failed scan into a clean result. The wrapper also gives ZAP
an informative log level and mounts only its internal log file, so a failed run can emit
one bounded, redacted diagnostic from the scanner output or internal ZAP log without
retaining raw scanner state or leaving container-owned files for runner cleanup.

The workflow has `contents: read` only and receives only the DAST test password through
an explicit secret mapping. Raw traffic, session state, and reports exist only in the
ephemeral runner directory; the job summary contains release correlation, hostnames,
image/policy identifier, duration, endpoint coverage, and severity counts. Findings are
advisory. Related SCRUM-297 owns the separately reviewed promotion-blocking threshold.

A ZAP exit code alone cannot distinguish a clean scan from an aborted crawl: both can
produce a report with `docker_exit=2` and zero findings at every severity. The wrapper
extracts the report's site count and `insight.endpoint.total` stat, surfaces them as
`Endpoint coverage: sites=…, endpoints=…` in the summary, and fails the job outright when
zero endpoints were scanned, instead of letting an aborted authentication or crawl read as
an advisory "no findings" result.

### Investigation history — zero findings on early validation runs

The first four post-merge validation runs each completed with `docker_exit=2` and zero
findings at every severity, with two different internal ZAP diagnostics
(`java.util.ConcurrentModificationException`, then `org.hsqldb.HsqlException: connection
exception: closed`) despite confirmed real crawl coverage (5 sites, 34-35 endpoints) on
the third and fourth runs. Two mitigations were tried and merged during triage —
`passiveScan-wait` jobs around `activeScan` (real fix for a separate report/passive-scan
race; see above) and reduced `spiderClient` `maxChildren`/`maxCrawlDepth` (disproven: an
80% reduction produced near-identical coverage and the same exception, ruling out crawl
volume as the trigger) — neither resolved the zero-finding outcome.

Reproducing the full plan locally (spider, guard script, `activeScan`, report) against a
safe public target, outside the approved-staging-only boundary this runbook enforces,
isolated the actual cause: the unsubstituted `pollUrl` documented above. With the fix, the
same local reproduction completed with `docker_exit=0` and real findings across every
severity (`high=2, medium=3, low=3, informational=2`). The `HsqlException` was a downstream
symptom of ZAP's abnormal shutdown after its `insight.auth.failure` stopping condition
triggered — not an independent concurrency bug — so no `ZAP_IMAGE` change was needed. The
`passiveScan-wait` and coverage-visibility changes remain valuable independently of this
fix; the spider-load reduction is harmless but was not the cause and could be reverted.

## Constitution compliance

The design keeps authorization server-side and uses a minimum-scope synthetic user;
it does not change CrewSafe application behavior, deterministic safety policy,
Terraform, deployments, migrations, or AWS access. Static fixture tests precede the
workflow and scripts, including negative tests for malformed targets, secret handling,
caller ordering, method/host enforcement, and advisory versus unavailable outcomes.

An authorized maintainer must perform the first post-merge staging validation through
the normal CI deployment path and record only sanitized evidence. No workstation scan,
manual AWS operation, or secret value belongs in this procedure.
