# SCRUM-347 — ML-service CI and container security gate

## Scope and trigger boundary

`ML-service CI` is a validation-only GitHub Actions workflow. It runs for pull
requests to `main`, pushes to `main`, and manual dispatches. Automatic runs are
limited to changes in `ml-service/` and the workflow, its SCRUM-347 helpers and
tests, shared Trivy filter, and ML-service exception source. It has only
`contents: read` permission and uses concurrency cancellation for superseded
runs on the same ref.

Repository administrators must add **ML-service CI / Verify ML-service** as a
required pull-request check for paths governed by this workflow. Do not use this
workflow to publish an image, deploy a service, configure AWS, log in to a
registry, or access cloud credentials.

## What a successful run proves

In this order, the job runs the committed workflow/helper self-tests, installs
the Python 3.11 lock file with `--require-hashes`, executes
`test_forecast.py`, builds a local image, and runs the container smoke helper.
The smoke helper removes AWS credential variables, disables EC2 metadata,
binds the temporary port to localhost, checks `/health` and a synthetic
`/forecast` request, confirms a non-root runtime user, confirms
`/app/requirements.txt` is not writable, and always removes the test
container.

The job then validates and filters the dedicated Trivy exception source,
creates an ephemeral active ignorefile, produces a vulnerability-only JSON
report, appends a redacted summary, and uploads the report for seven days.
Under SCRUM-455, valid HIGH/CRITICAL findings are report-only through
2026-09-17 UTC with approval owned by **CrewSafe security team**; the policy
becomes blocking on 2026-09-18 UTC unless superseded by a newer approval.
Scanner, registry, malformed-report, identity, summary, upload, and other
evidence-generation failures still fail the check in both modes. The summary
records the policy mode, owner, expiry, and evaluation date, so a report-only
result must not be described as a blocking security approval.

`backend-ci.yml` follows the same report-only policy. Its existing backend image
scan now writes a vulnerability-only JSON report and appends a redacted
`Backend image vulnerability scan` section before AWS credentials are assumed;
the image can still publish when findings are present.

## Exception review

Exceptions live only in
`.github/security/ml-service-image.trivyignore.source` and are reviewed in a
pull request. Each non-comment entry requires a CVE or GHSA identifier,
`owner:`, `reason:`, and `exp:YYYY-MM-DD`. The validator rejects malformed,
missing, and expired metadata. The shared filter writes only current IDs to an
ignored runner-local file, so an invalid or expired exception cannot suppress a
finding.

Use an exception only for a time-bounded, reviewed risk. Record the responsible
owner and actionable remediation reason, set the shortest defensible expiry,
and remove the entry when fixed. Never add a wildcard, a credential, a scan
`continue-on-error`, or a non-vulnerability scanner to evade the gate.

## Evidence and diagnostics

Open the relevant **ML-service CI** run in GitHub Actions. The job summary
contains only the revision, image label, counts, and an allowlisted
HIGH/CRITICAL finding table. The machine-readable JSON artifact is named
`trivy-ml-service-report` and expires after seven days. Do not paste its raw
content into Jira, pull requests, tickets, or chat.

For a failed smoke check, use the step's bounded diagnostics and rerun only
after fixing the container startup, health/forecast contract, runtime user, or
file permissions. The smoke helper deliberately does not need AWS and should
not be given AWS credentials to make a failure pass.

For a hash-install failure, verify the package version and hashes from the
trusted package index, add all required platform wheel hashes to the reviewed
lock file, and rerun the service tests and image build. Do not remove
`--require-hashes` or replace it with an unpinned install.

For a Trivy finding, remediate the package or base image first. If the risk is
accepted temporarily, add a reviewed, owner/reason/expiry exception as above;
do not weaken the severity threshold or report-generation behavior. The current
report-only result must not be described as a blocking security approval.

## Local verification

These checks do not require cloud credentials:

```sh
.github/scripts/tests/test-ml-service-ci-workflow.sh
.github/scripts/tests/test-ml-service-smoke.sh
.github/scripts/tests/test-validate-ml-service-trivy-exceptions.sh
.github/scripts/tests/test-summarize-trivy-report.sh
.github/scripts/tests/test-filter-trivyignore.sh
.github/scripts/tests/test-resolve-trivy-policy-mode.sh
.github/scripts/tests/test-ci-guards.sh

docker build -t crewsafe-ml-service:local ml-service
.github/scripts/ci/run-ml-service-smoke.sh crewsafe-ml-service:local
docker run --rm --entrypoint python crewsafe-ml-service:local -m pytest test_forecast.py
```

Never run Terraform as part of this verification.
