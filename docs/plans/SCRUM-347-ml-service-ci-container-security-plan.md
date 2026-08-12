# SCRUM-347 — ML-service CI and container security gate plan

## Decision

Add a dedicated, path-aware GitHub Actions validation gate at
`.github/workflows/ml-service-ci.yml`. It is intentionally separate from image
publication and deployment workflows: it has `contents: read` only, uses no
AWS or registry credentials, and neither pushes an image nor changes cloud
state.

The gate runs for pull requests and pushes to `main` that alter the ML service
or its own workflow/policy sources, plus manual dispatch. SHA-pinned actions,
concurrency cancellation, and workflow self-tests make the check scope and
policy independently observable.

## Validation sequence

1. Run deterministic shell self-tests for workflow, smoke, exception, and
   summary contracts.
2. Install the committed Python 3.11 dependencies with `--require-hashes` and
   run the existing unit/API-contract suite.
3. Build the local Docker image and run it without cloud credentials.
4. Prove health and synthetic forecast behavior, non-root execution,
   immutable dependency manifest, bounded requests, and cleanup.
5. Validate reviewed ML-service Trivy exceptions, derive a runner-local active
   ignorefile, create a vulnerability-only JSON report, write a redacted
   summary, retain the report artifact for seven days, and finally block on
   HIGH/CRITICAL findings.

The report and blocking scans are separate by design: an evidence-generation,
summary, or upload error cannot turn a security failure into a passing check.
Raw Trivy descriptions are never copied into the job summary.

## Lock-file correction

The existing Python 3.11 lock file supplied an x86_64 Linux wheel hash for
`jiter==0.16.0` and `pydantic-core==2.23.4`, but not their Linux ARM64 wheel
hashes. Local container verification therefore failed under hash enforcement.
The lock file now retains the existing x86_64 hashes and adds the verified
ARM64 hashes, preserving `--require-hashes` for both platforms rather than
weakening dependency verification.

## Operational handoff

See [SCRUM-347 runbook](../runbooks/SCRUM-347-ml-service-ci-container-security.md)
for required-check setup, exception review, evidence retention, diagnostics,
and recovery. The local Spec Kit artifacts remain ignored; this document is
the durable implementation decision record.

## Constitution compliance

- **Secure by design:** least-privilege workflow, no secrets, no cloud or
  publish operations, explicit credential-free smoke execution, fail-closed
  scanner/report pipeline, and reviewed time-bounded exceptions.
- **Test-first evidence:** helper and workflow mutation tests were created and
  observed failing before implementation; unit/API tests run before image and
  scan evidence.
- **Maintainability and reliability:** small single-purpose helpers, pinned
  actions, bounded retries/timeouts, cleanup traps, reproducible hash-locked
  dependencies, and Jira-keyed operational documentation.
- **Scope:** no Terraform, deterministic safety-policy, authorization,
  database, or user-interface behavior is changed.
