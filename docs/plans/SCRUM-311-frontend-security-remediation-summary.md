# SCRUM-311 Frontend Security Remediation Summary

**Branch:** `enhancement_frontend-security`  
**Reviewed through:** `17d9d05`  
**Date:** 2026-08-12  
**Status:** Implementation complete and locally verified; CI and runtime closure remain pending  

## Scope

This document summarises the security problems found in the CrewSafe React/Vite web application, why they mattered, and how this branch addressed them. Infrastructure is included only where it owns the SPA delivery boundary through S3, CloudFront, Cognito configuration, or web deployment CI.

The browser controls are defence in depth. Backend authorization remains authoritative, and malicious-client-resistant absolute-session enforcement remains a separate Cognito/backend follow-up.

## Problems and remediations

| Reference | Problem | Why the fix matters | What was changed | Evidence and current status |
| --- | --- | --- | --- | --- |
| AUTH-01 | A valid Cognito browser session had no application idle deadline or stable absolute deadline. Silent token renewal could keep the browser usable beyond the intended shift boundary. | An unattended or shared device could retain access longer than intended. A deadline derived from token expiry alone would also move whenever a token was renewed. | Added a 30-minute idle timeout, two-minute idle warning, and eight-hour absolute timeout anchored to Cognito `auth_time`, with a five-minute absolute warning. Added a five-second OIDC request timeout and kept the policy active for every token-bearing state, including backend failure and not-provisioned states. | Unit and component coverage is in `sessionPolicy.test.ts`, `useSessionTimeout.test.tsx`, and `sessionSecurity.test.tsx`. Local implementation is complete. Authenticated Cognito/browser evidence is still required. |
| AUTH-02 | Signing out removed the local OIDC user but did not explicitly revoke the refresh token. Failure paths could also postpone or interrupt cleanup. | A refresh token can outlive the current access token. On a shared browser, incomplete local or Hosted UI logout could allow a later user to regain the prior session. | Added bounded best-effort refresh-token revocation. Local user removal, provider state reset, and Cognito Hosted UI logout now proceed even when revocation or browser-storage cleanup fails. | Revocation ordering and failure paths are covered in `sessionSecurity.test.tsx`. Real renewal and revocation traffic must still be captured in the authenticated browser run. |
| AUTHZ-01 | Role checks controlled navigation visibility, but a signed-in user could type a route directly before a page-level guard ran. Role rules were duplicated across navigation and routing. | Hidden links are presentation, not authorization. Duplicated role rules can drift and expose screens to roles that should never mount them. | Added canonical `ROUTE_ACCESS`, derived navigation from it, and wrapped every registered signed-in destination in `RoleRoute` before mounting the page. | `routeAccess.test.tsx` covers direct-route denial, allowed management access, and placeholder-route parity. Backend endpoint authorization remains the security boundary. |
| DATA-01 | SSE conditions data crossed into application state through TypeScript assertions without runtime validation. Malformed, non-finite, or structurally invalid data could reach safety-related UI and trend logic. | TypeScript types disappear at runtime. Trusting an external payload could display corrupt readings, pollute a trend, or suppress a safety signal. | Added a runtime decoder for JSON shape, UUIDs, timestamps, enums, finite values, and impossible negative measurements. Invalid payloads emit no snapshot and degrade the stream. Finite but implausible WBGT or humidity values remain visible with a verification warning; warned WBGT values are quarantined from the trend chart. | Decoder, stream, hook, and panel coverage passes locally. Exhaustive invalid-input ownership remains in `conditionsDecoder.test.ts`; stream tests verify representative mapping and delivery behaviour. |
| CSP-01 | The active Vite-to-S3-to-CloudFront path did not deliver the intended browser security policy, and build-time API/Cognito origins could drift from the policy deployed at the edge. | Tokens are stored in `sessionStorage` and remain readable by injected JavaScript. CSP is therefore an important injection mitigation. Origin drift can also break login, renewal, API, or SSE traffic after deployment. | Added a CloudFront response-headers policy with CSP Report-Only, HSTS, frame denial, MIME-sniffing protection, referrer policy, and Permissions Policy. Attached it to both default and `/index.html` behaviours. Added `verify-edge-contract.sh` to compare the live `connect-src` set with the exact Vite API, issuer, and Hosted UI origins before upload. | Terraform source, formatting, validation, and mocked tests passed locally. The policy is intentionally Report-Only until live authenticated browser evidence is clean. |
| EDGE-01 | Both web deployment paths previously owned inline S3 commands and did not enforce distinct caching for hashed assets and the mutable SPA shell. | Long-caching `index.html` can strand clients on a stale bundle. Duplicated upload logic can also drift between automatic deployment and manual recovery. | Added `sync-static-site.sh`. Non-`index.html` assets use `public, max-age=31536000, immutable`; `index.html` is uploaded separately with `no-store`. Both workflows now run edge verification, shared sync, and CloudFront invalidation in that order. | Workflow and negative-fixture guards pass locally. Live response headers and object metadata must still be captured after the approved deployment. |
| SCA-01 | The web pipeline did not have a whole-tree dependency audit gate, and the router dependency required remediation. | Vulnerable transitive dependencies can enter through a valid lockfile even when application code is unchanged. A documented audit without an executable gate is easy to skip. | Upgraded `react-router-dom` to `7.18.2`, regenerated the lockfile, added `npm run audit`, and made both web CI and manual sync fail on moderate-or-higher npm advisories. | The lockfile audit reported zero vulnerabilities during local verification. The PR/main CI audit remains the formal gate. |
| LOG-01 | A missing-roster diagnostic wrote worker identifiers to the browser console in production builds. | Browser logs can persist, be copied into support evidence, or be visible to users who should see only the safe fallback message. | Restricted the identifier-bearing diagnostic to development builds while retaining the visible `Worker not found` fallback in production. | `ShiftList.test.tsx` includes a production-mode regression test proving the identifier is not logged. |
| CI-01 | After S3 deployment logic moved into a shared script, older structural guards still searched the workflow YAML for literal `aws s3 sync` and `--delete` commands. | Correct deployment code would fail CI, while tests at the wrong layer would not protect the cache contract inside the shared script. This weakened both delivery confidence and regression coverage. | Updated the guards to validate responsibilities at the correct boundaries: workflow orchestration checks edge verification, shared sync, and invalidation order; sync-script checks cover fail-fast behaviour, pruning, index exclusion, immutable asset caching, and `no-store` for the SPA shell. Added negative fixtures for missing steps and weakened cache policies, then wired the runtime-config and manual-sync self-tests into `security-scan.yml`. | `test-web-ci-runtime-config.sh` passed 23/23 checks; `test-web-sync-workflow.sh` passed 51/51 checks; deployment, staging, shell syntax, and `actionlint` checks passed. |

## Local verification record

| Check | Result | What it demonstrates |
| --- | --- | --- |
| Web unit/component suite | 21 files, 142/142 tests passed | Session, authorization, data-decoding, stream, UI, and privacy regressions are covered. |
| TypeScript type-check | Passed | Production and test contracts compile without type errors. |
| ESLint | 0 errors; one existing Fast Refresh warning | No lint-blocking defects were introduced. |
| Production build | Passed; existing bundle-size advisory remains | The secured frontend still produces a deployable Vite bundle. |
| Deployment guards | Passed | Both deployment paths retain verification, shared sync, and invalidation sequencing. |
| Manual sync guard | 51/51 checks passed | Workflow boundaries, cache behaviour, least-privilege expectations, and negative fixtures are enforced. |
| GitHub Actions lint | Passed | Modified workflow YAML and expressions are structurally valid. |
| Terraform source guard | 44 checks passed | The response-policy and IAM changes preserve the existing compute security constraints. |
| Terraform format and validate | Passed | The compute configuration is formatted and valid with the installed provider. |
| Mocked Terraform tests | 23 tests passed in an isolated backend-free copy | CloudFront policy attachment and infrastructure assertions pass without reading the production S3 backend. |
| Dependency audit | 0 vulnerabilities during local lockfile verification | The current dependency tree passed locally; CI must repeat the audit. |
| Diff hygiene | Passed | The final branch changes contain no trailing-whitespace errors. |

## Remaining closure work

| Gate | Required evidence | Status |
| --- | --- | --- |
| PR and main CI | Green dependency audit, lint, type-check, web tests, build, security self-tests, Terraform validation, source guard, and mocked Terraform tests | Pending |
| Infrastructure rollout | Approved Terraform plan/apply showing the response-headers policy and both CloudFront behaviour attachments | Pending |
| Live edge | Response and cache headers for `/`, `/index.html`, a deep link, and a real hashed asset | Pending |
| Authenticated browser run | Login, callback, logout, refresh-token renewal/revocation, API, SSE, conditions chart, and both date pickers under CSP Report-Only | Pending |
| CSP enforcement | No unexplained Report-Only violations, followed by promotion of the same policy string to enforced CSP and a repeated browser/edge check | Deferred until browser evidence is clean |
| Server-side absolute boundary | Web-specific Cognito refresh lifetime and backend `auth_time` maximum-age enforcement | Separate backend/identity follow-up |

## Outcome

The branch closes the identified frontend implementation gaps locally and adds regression guards at the application, deployment, and infrastructure boundaries. The findings must remain open until CI, approved deployment, live-edge checks, and authenticated browser evidence are recorded. CSP enforcement and malicious-client-resistant session age are deliberately not claimed by this branch.
