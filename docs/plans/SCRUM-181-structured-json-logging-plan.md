# SCRUM-181 — Structured JSON logging and log shipping plan

## Approved design

Configure the existing Spring Boot backend to emit one ECS JSON object per
console event. Spring Boot 3.5.13's built-in formatter is used; no runtime
logging dependency, sidecar, API, database table, or new aggregation service is
introduced.

The existing SCRUM-180 correlation contract remains authoritative:

- `RequestIdFilter` validates or generates a UUID.
- `X-Request-Id`, the SLF4J MDC, and audit `correlation_id` continue to use that
  same value.
- ECS output includes the MDC `requestId` as a queryable top-level field.

The ECS service metadata is `crewsafe-backend` from
`spring.application.name`, with the active Spring profile as the environment.
The existing Terraform-owned CloudWatch group
`/crewsafe/shared-dev/backend` remains the staging destination. ECS `awslogs`
uses non-blocking mode with a bounded `25m` buffer; no log-group auto-creation
or execution-role boundary changes are made.

## Safe logging boundary

Application log messages use static event names and only bounded operational
values such as counts, durations, enums, and configured timeouts. The reviewed
call sites do not log credentials, tokens or token subjects, request bodies,
model context, downstream response bodies, URLs, user/worker/site identifiers,
precise location, health details, or raw exception messages and stack traces.
Audit records retain their existing identifiers and semantics; audit storage is
separate from application log output.

## Test-first evidence

The implementation began with failing tests for ECS output, service metadata,
MDC correlation, malformed correlation input, MDC cleanup, ECS task shipping,
and unsafe dynamic log arguments. The focused contract suite now passes:

```text
StructuredLoggingContractTest: 2 tests, 0 failures
LogSafetyContractTest:          1 test, 0 failures
RequestIdFilterTest:             5 tests, 0 failures
```

Terraform validation and `terraform test` remain CI-only under the repository
working agreement. No local AWS access, Terraform plan, state, or saved plan is
permitted.

## Constitution compliance

- No secrets, PII, Terraform state, or generated Spec Kit artifacts are
  committed.
- Server-side authorization, audit semantics, and the deterministic safety
  policy are unchanged.
- The existing Spring Boot/ECS/CloudWatch stack is reused without an ADR.
- Tests precede implementation and the negative log guard is wired into the
  security gate self-tests.
- Staging verification uses sanitized evidence only; raw logs and request
  identifiers must not be copied into tickets, artifacts, or reports.

## Rollback boundary

Rollback is a reviewed pull request followed by the normal CI deployment path.
Revert the backend structured-logging configuration and/or the ECS log-driver
options as one scoped change. Do not run Terraform or an AWS deployment from a
workstation. The existing CloudWatch log group and audit database remain in
place during rollback.
