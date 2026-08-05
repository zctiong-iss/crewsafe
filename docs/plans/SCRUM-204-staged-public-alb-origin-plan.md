# SCRUM-204 — Staged public ALB origin migration plan

## Decision

Restore the shared-development CloudFront endpoint through a new, parallel internet-facing
Application Load Balancer (ALB), fenced to AWS's managed CloudFront origin-facing prefix list.
Do not convert or replace the recovered internal ALB in place. Deliver three separately reviewed
and merged revisions:

1. **Preparation** — add and validate the public path while CloudFront remains on the surviving
   VPC origin.
2. **Cutover** — repoint only the existing CloudFront origin after the public target is healthy,
   retaining the complete legacy path for rollback.
3. **Cleanup** — after two successful smoke passes five minutes apart, remove only the
   unreferenced legacy path, narrow migration permissions, and prove a fresh plan has no changes.

This sequencing is mandatory because the Terraform plan/apply workflows run only from `main`.
Each intermediate topology must therefore be a reviewed `main` revision before it can have an
exact CI plan. A single final-state PR would erase the preparation and rollback gates.

## Failure being prevented

Run 30880087606 attempted the public-ALB conversion in one Terraform graph. It removed listener
and security-group connectivity and deleted an unused VPC origin before CloudFront rejected
deletion of the origin it still referenced. SCRUM-204 must not repeat that replacement/removal
race.

The existing VPC-origin path was built twice and remained unable to route traffic despite healthy
targets and successful reachability checks. The public alternative accepts a documented
shared-development concession: CloudFront reaches the ALB over HTTP because the project owns no
domain for a trusted origin certificate. Port 80 ingress is limited to
`com.amazonaws.global.cloudfront.origin-facing`, but that list covers the CloudFront fleet rather
than this distribution alone. Cognito authentication and deny-by-default server-side site/object
authorization remain authoritative.

## Topology by revision

| Revision | CloudFront origin | Legacy path | Public path | Rollback |
| --- | --- | --- | --- | --- |
| Preparation | Surviving VPC origin | Active, unchanged | Added and healthy | Existing path |
| Cutover | Public ALB custom origin | Retained | Active | Fresh revision restoring VPC origin |
| Cleanup | Public ALB custom origin | Removed after evidence | Active | Reviewed remediation |

The public path uses distinct Terraform identities for its ALB, security group, rules, target
group, listener, and application-security-group ingress. The existing private ECS service
registers the same container and port with both target groups during preparation and cutover.

## Shared gates

Every stage requires:

- a narrow SCRUM-204 PR and constitution-compliance statement;
- tests first, with expected failure captured by Terraform Validation on a draft PR;
- successful required CI and no unreviewed high-severity finding;
- a reviewed, merged `main` revision and fresh `compute-shared-dev` plan;
- an exact single-use plan, typed `APPLY <alias> compute-shared-dev`, and linked evidence;
- validation tied to the exact revision, account, component, operation, and dependency lock.

Stale, reused, mismatched, already-applied, or unreviewed plans are rejected. Terraform never runs
locally.

## Stage boundaries

**Preparation** adds only the public path and second ECS target-group attachment. The internal
ALB, surviving VPC origin, distribution origin, ECS task placement, and application boundary have
zero change/replacement/destruction. Cutover is blocked until the public target is healthy and
prefix-list-only ingress is verified.

**Cutover** changes only the existing distribution's `backend` origin to the public ALB using an
HTTP-only custom origin. Distribution identity, `staging_base_url`, edge policies, methods,
viewer behavior, internal ALB, VPC origin, and both registrations remain. Two smoke passes five
minutes apart must prove health p95 under one second, protected-read p95 under one second,
state-changing p95 under two seconds, action visibility within 60 seconds, authenticated success,
and unauthenticated denial. Failure uses a fresh reviewed rollback revision and plan.

**Cleanup** removes only the unreferenced legacy path and VPC-origin IAM verbs. The deployed IAM
policies retain `GetVpcOrigin`/`DeleteVpcOrigin` through refresh/deletion; immediately afterward,
operators reconcile them from the already reviewed narrower repository documents. All smoke,
security, performance, and propagation evidence repeats, followed by a fresh no-change plan.

## Constitution compliance

The design stays in the existing compute component, introduces no secret or internet-wide
ingress, preserves server-side authorization, requires negative and test-first evidence, uses
canonical textual stage outcomes, and measures readiness, performance, recovery, and convergence.
No constitution exception or ADR is required. A controlled domain and trusted origin certificate
remain separate work.
