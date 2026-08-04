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
| Source commit and approved PR | `737fd928f560cceca57ed2c497b59708bbb2b90d`, PR [#71](https://github.com/zctiong-iss/crewsafe/pull/71) | `ed098bb1985132e9bab4b38dd0821b94f5519480`, PR [#73](https://github.com/zctiong-iss/crewsafe/pull/73) | Cleanup branch created from applied cutover revision |
| Expected failing / passing validation runs | [Expected red run 30883961904, compute job 91911195962](https://github.com/zctiong-iss/crewsafe/actions/runs/30883961904/job/91911195962) / [passing run 30884687670, compute job 91913410440](https://github.com/zctiong-iss/crewsafe/actions/runs/30884687670/job/91913410440) | [Expected red run 30886599486, compute job 91919329837](https://github.com/zctiong-iss/crewsafe/actions/runs/30886599486/job/91919329837) / [passing run 30887107913, compute job 91920846373](https://github.com/zctiong-iss/crewsafe/actions/runs/30887107913/job/91920846373) | Blocked |
| Plan run ID and attempt | `30885366655`, attempt 1 | `30887456082`, attempt 1 | Blocked |
| Account / component / operation / lock match | `dev` / `compute-shared-dev` / `apply`; exact-plan validation passed | `dev` / `compute-shared-dev` / `apply`; exact-plan validation passed | Blocked |
| Plan digest and typed confirmation | Plan metadata validated; `APPLY dev compute-shared-dev` | Plan metadata validated; `APPLY dev compute-shared-dev` | Blocked |
| Apply run and single-use marker | [Run 30885467533, job 91915592556](https://github.com/zctiong-iss/crewsafe/actions/runs/30885467533/job/91915592556); final marker step passed | [Run 30887529413, job 91921935284](https://github.com/zctiong-iss/crewsafe/actions/runs/30887529413/job/91921935284); final marker step passed | Blocked |
| Target and distribution status | Apply: 7 added, 1 changed, 0 destroyed. Public target group `crewsafe-shared-dev-public`: 1 healthy, 0 unhealthy; CloudFront intentionally retained the VPC origin | Apply: 0 added, 1 changed, 0 destroyed. Existing distribution reached terminal deployment on the public ALB origin | Blocked |
| Smoke, latency, propagation, authn/authz | N/A | Two health passes returned 200/UP more than five minutes apart; 20 health p95 0.043 s; authenticated protected request 200; unauthenticated equivalent 401; synthetic create 201 in 0.462 s, immediate read visibility, 20 protected-read p95 0.103 s, 20 state-changing p95 0.115 s, cleanup delete 204 | Blocked |
| Rollback status / convergence plan | Active legacy path | Cutover accepted; legacy path retained until reviewed cleanup | Blocked |

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

Test-first evidence was published in draft PR
[#71](https://github.com/zctiong-iss/crewsafe/pull/71). After the formatting-only correction in
`b803287`, run `30883961904` reached `terraform test`: seven existing runs passed and
`parallel_public_origin_preparation` failed because the public ALB, its target group/listener,
managed-prefix-list data source, and security-group rules were undeclared. This is the expected
failure the preparation implementation must turn green.

Implementation commit `1a1ed34` added the parallel resources without changing the active
CloudFront origin. Terraform Validation run `30884687670` passed every job; compute job
`91913410440` passed formatting, validation, mocked-provider tests, the 19-check preparation
source guard, and infrastructure scanning in 42 seconds. No Terraform command ran locally.

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

Preparation gate accepted on 2026-08-04. Apply run `30885467533` used the reviewed plan from run
`30885366655` against source `737fd928f560cceca57ed2c497b59708bbb2b90d` and completed with
7 additions, 1 in-place ECS service change, and no destruction. The operator inspected target group
`crewsafe-shared-dev-public` in `ap-southeast-1`: one IP target on port 8080 was `Healthy`, with zero
unhealthy, initial, draining, or unused targets. The reviewed Terraform validation binds ALB ingress
to `com.amazonaws.global.cloudfront.origin-facing` on TCP/80, forbids CIDR ingress, and restricts
the ALB-to-application hop to the application security group on TCP/8080. The cutover branch
`feat/scrum-204-staged-public-alb-origin-cutover` was created from that applied `main` revision.

## 6. Cutover and rollback

Use a fresh `feat/scrum-204-staged-public-alb-origin-cutover` branch from applied preparation.
Cutover may change the existing `backend` origin to the public ALB's HTTP-only custom origin. It
must not replace the distribution/output, delete legacy resources, remove either target
registration, widen ingress, or introduce an origin secret.

Test-first commit `5f5213b` was published in draft PR
[#73](https://github.com/zctiong-iss/crewsafe/pull/73). Terraform Validation run `30886599486`
passed configuration validation and seven existing compute runs, then the
`public_origin_cutover` run failed because `custom_origin_config` was null. This is the expected
failure that the cutover implementation must turn green; all other completed component, catalog,
lockfile, and security jobs passed.

The implementation changes only the existing distribution's `backend` origin domain to
`aws_lb.public.dns_name` and replaces its selected `vpc_origin_config` block with an HTTP-only
`custom_origin_config` on port 80. The surviving `aws_cloudfront_vpc_origin.rebuilt`, internal ALB,
legacy listener/target group, public path, both ECS registrations, cache/origin-request policies,
viewer certificate, allowed methods, and `staging_base_url` output remain unchanged for rollback.

Implementation commit `d3f3a7b` turned the expected-red checkpoint green. Terraform Validation
run `30887107913` passed formatting, validation, mocked-provider tests, the 23-check cutover source
guard, component/workflow guards, lockfile checks, Gitleaks, and infrastructure scanning. The
`compute-shared-dev` job was `91920846373`; every job in the workflow passed. No Terraform command
ran locally.

Wait for CloudFront `Deployed`, then run two passes at least five minutes apart:

- health HTTP 200, no edge-generated 5xx, and 20-sample p95 below one second;
- representative protected-read p95 below one second;
- representative state-changing p95 below two seconds and visibility within 60 seconds;
- authenticated success and equivalent unauthenticated denial.

Use approved synthetic fixtures and never expose a bearer token. Any failure blocks cleanup and
requires a fresh reviewed rollback revision/plan restoring the retained VPC origin.

Cutover gate accepted on 2026-08-04. Apply run `30887529413` applied reviewed plan
`30887456082` from `main` source `ed098bb1985132e9bab4b38dd0821b94f5519480`: only the existing
distribution changed, with no additions or destruction. Two health passes more than five minutes
apart returned HTTP 200 and `UP`; 20 health samples had p95 0.043 seconds. The mapped synthetic
supervisor received HTTP 200 from a protected read while the unauthenticated equivalent received
HTTP 401. A reversible synthetic shift exercise returned create 201 in 0.462 seconds, was visible
immediately, produced 20/20 protected reads at p95 0.103 seconds and 20/20 updates at p95 0.115
seconds, and ended with delete 204. No token, credential, domain record, or synthetic object
identifier is retained as evidence.

## 7. Cleanup

Use a fresh `feat/scrum-204-staged-public-alb-origin-cleanup` branch only after accepted cutover
evidence. Cleanup may delete only the unreferenced VPC origin/internal ALB path and legacy ECS
attachment; it must preserve the public path, distribution, runtime, network, database, and secrets.

The cleanup branch was created from applied cutover revision
`ed098bb1985132e9bab4b38dd0821b94f5519480` after the cutover evidence above passed. Any material
change to that evidence or active origin blocks cleanup and requires a fresh branch and plan.

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
