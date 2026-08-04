# Runbook — staged public ALB origin migration (SCRUM-204)

## 1. Rules

This runbook moves the stable shared-development CloudFront endpoint from the recovered VPC origin
to a separately prepared public ALB without repeating run 30880087606's one-graph migration.

- Run no Terraform locally; use only reviewed GitHub Actions plan/apply workflows.
- Never combine preparation, cutover, and cleanup in one PR or plan.
- Never use `-target`, manual resource deletion, state editing, or a saved plan from another run.
- Reject stale, reused, mismatched, already-applied, or unreviewed plans.
- Never admit `0.0.0.0/0`, add an origin secret/header, or add a fixed application-path response.
- Never record tokens, credentials, state, plan contents, PII, or domain records as evidence.

See [the SCRUM-204 plan](../plans/SCRUM-204-staged-public-alb-origin-plan.md). SCRUM-176 remains
authoritative for unchanged compute runtime behavior, but its one-step migration history is not an
active procedure.

## 2. Evidence record

Complete one column per stage with links and non-sensitive outcomes.

| Field | Preparation | Cutover | Cleanup |
| --- | --- | --- | --- |
| Source commit and approved PR | Pending | Blocked | Blocked |
| Expected failing / passing validation runs | Pending | Blocked | Blocked |
| Plan run ID and attempt | Pending | Blocked | Blocked |
| Account / component / operation / lock match | Pending | Blocked | Blocked |
| Plan digest and typed confirmation | Pending | Blocked | Blocked |
| Apply run and single-use marker | Pending | Blocked | Blocked |
| Target and distribution status | Pending | Blocked | Blocked |
| Smoke, latency, propagation, authn/authz | N/A | Blocked | Blocked |
| Rollback status / convergence plan | Active legacy path | Blocked | Blocked |

Evidence includes exact HTTP statuses, timestamps, target/distribution status, and latency samples
without sensitive headers. It must connect each result to the exact revision and deployment
identities.

## 3. Pre-change baseline — 2026-08-04

The following pure shell checks ran from repository root before preparation tests:

```bash
.github/scripts/terraform/tests/test-compute-source-guard.sh
.github/scripts/terraform/tests/test-component-catalog.sh
.github/scripts/terraform/tests/test-ci-guards.sh
.github/scripts/terraform/tests/test-workflow-guards.sh
```

All passed. The compute guard reported 17 checks; the CI guard included Cognito deployment and
backend-mode checks. Requirements were 16/16 complete. The branch was
`feat/scrum-204-staged-public-alb-origin` at `22614e9a2da4f6455fc469db2238b468e39fce12`.

## 4. Remote plan and apply

After the relevant stage PR is reviewed and merged, dispatch `Terraform Plan` on `main` with the
allowlisted account, component `compute-shared-dev`, and operation `apply`. Review its stage
boundary before dispatching `Terraform Apply` with the exact plan run/attempt and confirmation:

```text
APPLY <alias> compute-shared-dev
```

Apply must reject any existing marker at
`crewsafe/applied-plans/compute-shared-dev/<run>-<attempt>.json` and create it after success.

## 5. Preparation

The draft PR must first show the expected failing test-only validation. The implementation plan may
add the distinct public ALB path and second ECS target registration only.

| Allowed | Forbidden |
| --- | --- |
| Public ALB SG/rules, ALB, target group, listener | Change/replace/delete internal ALB |
| Managed CloudFront prefix-list data reference | Change/delete surviving VPC origin |
| Second ECS target-group attachment | Change CloudFront origin |
| App-SG ingress from public ALB SG | CIDR or `0.0.0.0/0` public ingress |

After apply, both target groups must be registered, the public target healthy, ingress exactly
TCP/80 from `com.amazonaws.global.cloudfront.origin-facing`, egress TCP/8080 to the application
SG, and CloudFront still on the VPC origin. Any failure blocks cutover.

## 6. Cutover and rollback

Use a fresh `feat/scrum-204-staged-public-alb-origin-cutover` branch from applied preparation.
Cutover may change the existing `backend` origin to the public ALB's HTTP-only custom origin. It
must not replace the distribution/output, delete legacy resources, remove either target
registration, widen ingress, or introduce an origin secret.

Wait for CloudFront `Deployed`, then run two passes at least five minutes apart:

- health HTTP 200, no edge-generated 5xx, and 20-sample p95 below one second;
- representative protected-read p95 below one second;
- representative state-changing p95 below two seconds and visibility within 60 seconds;
- authenticated success and equivalent unauthenticated denial.

Use approved synthetic fixtures and never expose a bearer token. Any failure blocks cleanup and
requires a fresh reviewed rollback revision/plan restoring the retained VPC origin.

## 7. Cleanup

Use a fresh `feat/scrum-204-staged-public-alb-origin-cleanup` branch only after accepted cutover
evidence. Cleanup may delete only the unreferenced VPC origin/internal ALB path and legacy ECS
attachment; it must preserve the public path, distribution, runtime, network, database, and secrets.

Reviewed source policies omit `cloudfront:GetVpcOrigin` and `cloudfront:DeleteVpcOrigin`, while the
already-deployed policies retain them through cleanup refresh/deletion. Immediately after success,
reconcile and verify the live plan inline policy and apply customer-managed policy from the
narrower reviewed files.

Repeat every cutover check, then dispatch a fresh plan. The required result is:

```text
No changes. Your infrastructure matches the configuration.
```

Investigate any non-empty convergence plan; do not apply it automatically. Final review requires
linked evidence for all stages, least-privilege live policies, no local Terraform, no sensitive
data exposure, canonical textual statuses, and no unreviewed high-severity finding.
