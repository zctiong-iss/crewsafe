# SCRUM-453 — Authenticated DAST security-header remediation

## Ownership and scope

SCRUM-453 owns the CloudFront security-header implementation, authenticated staging DAST
verification, evidence handling, and residual-risk disposition. SCRUM-329 is related context only
and is not an implementation dependency for this change.

The change is staging-only and covers the existing web and API CloudFront distributions:

- enforce the validated web CSP rather than emitting CSP Report-Only;
- add API-edge HSTS and remove the origin `Server` header on both delivery surfaces;
- preserve immutable hashed-asset caching, `index.html` `no-store`, API caching-disabled behavior,
  existing methods, and server-side authorization/site boundaries; and
- publish only bounded, redacted DAST evidence while retaining raw scanner output inside the
  ephemeral runner directory.

SCRUM-297 remains the owner of promotion-blocking DAST gate policy. This change does not silently
turn the advisory staging workflow into a new release gate.

## Implementation boundaries

Terraform changes remain in `infra/terraform/compute/web_security.tf` and
`infra/terraform/compute/main.tf`. Shell and workflow changes remain under
`.github/scripts/security/`, `.github/scripts/tests/`, and `.github/workflows/dast-staging.yml`.
The new sanitizer is a fail-closed boundary: invalid JSON, incomplete coverage, prohibited
sensitive material, or sanitizer failure produces no uploadable report.

No raw DAST report, token, cookie, authorization value, PII, response body, Terraform state, or
saved plan may enter Jira, source control, CI logs, or ordinary artifacts.

## Verification order

1. Write and run failing Terraform, edge-contract, DAST-workflow, sanitizer, and authorization
   regression tests.
2. Implement and verify the web/API edge policies through reviewed CI-only Terraform validation,
   plan, and apply, then wait for propagation.
3. Run the final authenticated staging DAST verification against the remediated edge and record
   before/after counts and finding dispositions using only redacted evidence.
4. Expire/revoke/rotate the synthetic scan identity as required and complete the security,
   performance, and regression review.

The final DAST result is not considered current until the US2 edge policy is deployed and observed
on representative web document, OAuth callback, static asset, and authenticated API responses.

## Acceptance evidence

- CI Terraform tests prove enforced CSP, HSTS, `Server` removal, policy attachments, cache
  behavior, and unchanged methods.
- Shell tests prove report sanitization, no raw artifact path, approved targets, safe methods,
  fail-closed incomplete scans, and redacted diagnostics.
- Backend security tests continue to prove deny-by-default and site-scoped authorization.
- Reviewed staging evidence shows required headers and cache behavior, fresh before/after DAST
  counts, reviewer-approved dispositions, and no active scan session.
- Performance evidence meets the 15-minute verification, 5-minute publication, and no-more-than-
  10%-p95-regression targets, or remains visibly non-passing with recovery action recorded.

## Operational constraints

Terraform, AWS changes, and authenticated DAST run only through the repository's reviewed CI and
staging deployment workflows. Never run Terraform or the authenticated scan from a workstation.
