# Runbook — SCRUM-182 Health Readiness

This runbook covers the additive liveness/readiness probes for the Spring Boot backend.
Health responses are intentionally status-only. Do not record credentials, tokens, NEA
payloads, dependency URLs, exception messages, or stack traces in incident notes.

## Probe contract

| Probe | Authentication | Healthy | Dependency failure |
|---|---|---|---|
| `/actuator/health` | None | `200 {"status":"UP"}` | Existing aggregate semantics; path remains unchanged |
| `/actuator/health/liveness` | None | `200 {"status":"UP"}` | Remains healthy while the process answers |
| `/actuator/health/readiness` | None | `200 {"status":"UP"}` | `503 {"status":"DOWN"}` |

Readiness includes application readiness, PostgreSQL, and the bounded NEA observation.
Liveness excludes external dependencies. The NEA observation starts unhealthy, is
refreshed every 30 seconds, expires after 60 seconds, and uses one bounded four-second
health attempt. Recovery is accepted on the next successful observation without a task
restart.

## Local verification

Prerequisites: Java 21, Maven Wrapper, and Docker for the Testcontainers integration
suite. Shared integration tests use the deterministic weather fixture; they do not call
the public NEA service.

```bash
cd backend
./mvnw -B -q -Dtest=NeaHealthMonitorTest,HealthEndpointTest,SecurityChainTest,HardeningTest test
./mvnw -B verify
```

Implementation evidence: the focused health endpoint suite passed 4 tests, including
the deterministic healthy-probe p95 assertion below one second. The full backend
verification passed 425 tests with zero failures, errors, or skips.

With a fixture-backed local process running:

```bash
curl -i http://localhost:8080/actuator/health
curl -i http://localhost:8080/actuator/health/liveness
curl -i http://localhost:8080/actuator/health/readiness
curl -i http://localhost:8080/api/v1/me
```

The three health paths require no credentials and return only `status`. The protected
API request remains unauthorized without a valid token and must not redirect or create a
session cookie.

## Degraded dependency checks

Use the isolated database health-contributor test double and synthetic NEA client in
automated tests. The expected behavior is:

1. Database failure returns readiness `503` while liveness remains `200`.
2. NEA transport, HTTP, timeout, malformed-response, or stale-observation failure
   returns readiness `503` while liveness remains `200`.
3. Restoring the dependency and running the next bounded observation returns readiness
   `200` without restarting the process.
4. Every response remains exactly status-only; logs contain only generic health reason
   codes and no dependency diagnostics.

Do not stop the shared Testcontainers database. If an actual database connection-loss
scenario is required, use a dedicated per-test database resource or an approved staging
procedure and restore it immediately.

## CI and staging verification

Build, scan, publish, deploy, and any staging fault injection through the reviewed CI
workflow. Do not run Terraform, `terraform plan`, or AWS mutation commands locally.

In staging, record only sanitized probe paths, HTTP statuses, and aggregate timing
statistics. Confirm that:

- the Dockerfile and ECS/ALB target group still use `/actuator/health` and its existing
  `200` matcher;
- readiness fails for controlled database and NEA failures while liveness succeeds;
- readiness recovers after dependency restoration without task restart;
- healthy probes meet the `<1s` p95 target and dependency-failure responses meet the
  `<=5s` bound; and
- no unrelated `/api/v1/**` route becomes public.

## Rollback and recovery

Rollback is the normal reviewed deployment rollback for the backend image. There is no
database migration or Terraform change for SCRUM-182. If a new task remains unready,
keep it out of service through readiness, inspect only sanitized CI/application health
evidence, and revert through the reviewed deployment path.

## Compatibility references

- `backend/Dockerfile` continues to probe `/actuator/health`.
- `infra/terraform/compute/main.tf` continues to use `/actuator/health` with matcher
  `200`.
- `infra/terraform/compute/tests/compute.tftest.hcl` continues to assert that target
  group contract.
- The SCRUM-176 compute runbook remains the infrastructure source for the target-group
  health path.

No Terraform, AWS plan/apply, staging fault injection, or real NEA credentials were
used during local verification.
