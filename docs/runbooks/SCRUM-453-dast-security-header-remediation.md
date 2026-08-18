# SCRUM-453 — DAST security-header remediation runbook

## Scope and ownership

SCRUM-453 owns the staging CloudFront security-header implementation and authenticated DAST
verification. SCRUM-329 is related context only. Production changes require a separate approved
release decision.

The approved targets are the reviewed staging web and API CloudFront HTTPS origins. The Cognito
Hosted UI is authentication-only and is never a DAST scan target.

Never record a password, token, cookie, authorization value, OAuth code/state value, session
storage value, PII, raw request/response body, raw scanner report, or query string in this runbook,
Jira, a pull request, CI output, or an ordinary artifact.

## Preconditions

- The staging release was deployed through the normal reviewed CI path and smoke checks passed.
- The synthetic DAST identity is staging-only, least-privilege, and limited to the approved
  read-only journey and site membership.
- Approved web/API origins and the pinned ZAP image pass the existing staging contract validator.
- The response-header policy has propagated and representative web document, OAuth callback,
  static asset, and authenticated API checks are available.
- The DAST workflow retains the existing GET/HEAD boundary and safe-operation exclusions.

If any precondition fails, mark the verification **non-passing** and preserve only a bounded,
redacted diagnostic.

## Expected edge controls

| Response class | Required evidence |
|---|---|
| Web document | Enforced `Content-Security-Policy`, HSTS, content-type, frame, referrer, and no `Server` disclosure |
| OAuth callback | Same enforced policy as the web document; query values are never recorded |
| Public static asset | Same applicable headers; immutable caching only for intentionally non-sensitive assets |
| Authenticated API | HSTS, restrictive response headers, no `Server` disclosure, caching disabled for user/site-specific data |

Report-Only CSP without enforced CSP is a failure. A platform-managed `Server` header that cannot
be removed requires a dated, time-bounded exception, compensating control, owner, rationale, and
expiry; it is not silently marked remediated.

## Verification procedure

1. Confirm the triggering release, staging environment, approved origins, and current timestamp.
2. Run the edge-contract checks after propagation. Record only pass/fail state, response class,
   timestamp, and safe header metadata.
3. Run the reusable authenticated DAST workflow. It must scan only the approved web/API origins,
   use the synthetic identity, and preserve the GET/HEAD guard.
4. Inspect the job summary and `dast-report-redacted.json` only. Confirm scanner metadata,
   endpoint coverage, severity counts, rule names, and paths without query strings.
5. Record before/after counts and each in-scope medium/low finding disposition below. Use
   **remediated** or **exception**; an exception requires owner, rationale, expiry, and reviewer.
6. Verify publication evidence contains no forbidden fields or sensitive values.
7. Expire/revoke/rotate the scan identity and sessions through the approved identity/secrets
   process. Record the action reference, timestamp, and owner only.

## Finding disposition record

| Finding scope | Before count | After count | Disposition | Owner | Rationale/evidence reference | Expiry/reviewer |
|---|---:|---:|---|---|---|---|
| Web CSP enforcement |  |  |  |  |  |  |
| API HSTS |  |  |  |  |  |  |
| Web/API `Server` disclosure |  |  |  |  |  |  |

Do not fill this table with scanner evidence, URLs containing query values, credentials, or PII.

## Evidence and currentness

Verification is current for no longer than 24 hours or until the staged release changes,
whichever comes first. The reviewer record must reference the Jira key, CI run, environment,
timestamp, redacted artifact, edge-check result, and identity-lifecycle action without secret
values. A missing, malformed, stale, or incomplete report is **non-passing**, never clean.

## Local contract verification

The following workstation-safe checks passed before CI/staging verification. Their output contains
no secrets and is summarized here rather than copied wholesale:

| Check | Result |
|---|---|
| `.github/scripts/tests/test-sanitize-dast-report.sh` | 12/12 passed |
| `.github/scripts/tests/test-dast-staging-workflow.sh` | 132/132 passed |
| `.github/scripts/tests/test-web-sync-workflow.sh` | 61/61 passed |
| `.github/scripts/terraform/tests/test-ci-guards.sh` | Passed |
| `cd backend && ./mvnw -Dmaven.repo.local=<private-temp-cache> -Dtest=SecurityChainTest,SiteAuthorizationTest test` | 23/23 passed |

Terraform validation/plan/apply, full backend Maven verification, authenticated staging DAST,
and identity lifecycle actions remain CI/reviewed-environment tasks. No Terraform or
authenticated DAST command was run from the workstation.

## Failure and recovery

- **Propagation pending**: mark header verification non-passing, wait for the reviewed deployment
  to propagate, then rerun the representative checks.
- **Target or authentication failure**: stop; preserve only the redacted diagnostic; correct the
  reviewed CI configuration or secret-store state; obtain a fresh scan.
- **Sanitizer failure**: do not upload any report. Treat the scan as unavailable and investigate
  in the ephemeral runner only.
- **Unrelated Terraform plan change**: stop plan review. Do not apply until the unrelated
  replacement, destruction, IAM broadening, or cache change is removed or separately approved.
- **Header regression**: revert through the reviewed CI plan/apply path, rerun smoke and edge
  checks, and obtain a new DAST result before disposition.

## Completion checklist

- [ ] Edge policy checks pass for all four response classes.
- [ ] Fresh DAST has zero unresolved in-scope medium findings and zero unresolved in-scope low
      findings, or every residual has an approved time-bounded exception.
- [ ] Redacted artifact and CI/Jira review contain no forbidden sensitive material.
- [ ] Synthetic identity sessions are expired/revoked/rotated and the action is recorded without
      secret values.
- [ ] Authorization-negative and cross-site/site-boundary tests remain passing.
- [ ] Performance, freshness, recovery, and reviewer acceptance evidence is attached to the
      change review.
