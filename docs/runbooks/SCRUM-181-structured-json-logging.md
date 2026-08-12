# SCRUM-181 Structured JSON logging and log shipping runbook

This runbook validates the staging logging contract through reviewed CI and
authorized CloudWatch access. Never run Terraform, use a local AWS profile, or
copy raw logs, credentials, tokens, PII, or real request identifiers into a
ticket or artifact.

## 1. Preconditions and access boundary

1. Confirm the SCRUM-181 implementation is merged through a reviewed pull
   request and the backend image was deployed by the normal staging workflow.
2. Use the approved staging observability role. Access is read-only for the
   CloudWatch log group `/crewsafe/shared-dev/backend` unless a separate,
   reviewed operational procedure grants more.
3. Generate a synthetic request correlation UUID in the controlled staging
   smoke test. Keep it in the temporary operator session only; do not paste it
   into Jira, GitHub summaries, or committed files.

## 2. CloudWatch Logs Insights query

Run the following query against the existing backend log group. Replace the
placeholder only in the temporary console query with the synthetic UUID from
the smoke test.

```text
fields @timestamp, requestId, log.level, service.name, message
| filter ispresent(requestId)
| filter requestId = "<synthetic-request-id>"
| sort @timestamp desc
| limit 50
```

The record should parse as JSON and expose `@timestamp`, `log.level`,
`log.logger`, `service.name`, `message`, and `requestId`. Compare the response
header and audit correlation value in the controlled test harness, not in a
report containing the identifier.

For a sanitized field-contract sample, query only presence and counts:

```text
fields @timestamp, requestId, log.level, service.name, message
| filter ispresent(requestId)
| stats count() as records,
        count_distinct(service.name) as services,
        count_distinct(log.level) as levels
```

Record only the counts, service name, severity names, time window, and pass or
fail outcome. Do not export `@message` or include raw event content.

## 3. Acceptance checks

- At least 95% of sampled events are queryable within 60 seconds of the
  controlled request under normal destination health.
- Every sampled record parses as one JSON object and has the required fields.
- The synthetic request's response, MDC-derived log record, and audit record
  correlate; the request identifier is not retained in evidence.
- No sampled record contains a credential, bearer token, token subject, request
  body, model context, downstream response, URL, user/worker/site identifier,
  precise location, health detail, raw exception message, or stack trace.
- The backend request latency p95 remains within 10% of the reviewed baseline.

## 4. Expected operator states

- **Empty:** no records appear in the selected short window. Check the selected
  log group, deployment timestamp, and synthetic request result before treating
  this as a failure.
- **Stale:** records exist but are older than 60 seconds. Check ECS task health,
  CloudWatch delivery health, and the deployment workflow; do not increase the
  application log level or dump raw logs.
- **Denied:** CloudWatch access is rejected. Stop and request the approved
  read-only role; do not use personal credentials or broaden IAM permissions.
- **Offline:** the service is unreachable. Preserve the CI/deployment links and
  retry only through the approved operator path after connectivity is restored.
- **Error:** records are malformed or contain forbidden content. Stop the
  rollout, preserve only sanitized metadata, and open a security/operations
  incident with the event category and deployment commit—not the raw event.

## 5. Bounded-buffer and recovery checks

The reviewed ECS task definition must retain `mode=non-blocking` and
`max-buffer-size=25m`. Verify these through the Terraform CI test and the
deployed task-definition review; never run Terraform locally.

If CloudWatch delivery is delayed, verify that the application remains
responsive and that the next scheduled/reviewed task replacement recovers
delivery without requiring an application code change. If a task fails to
start, use the existing ECS and CloudWatch diagnostics, then follow the normal
staging rollback workflow. Do not attach task logs, state, saved plans, or
secret-resolution output to the incident.

## 6. Rollback and closure

Rollback is performed by reverting the scoped pull request through CI. Re-run
the backend tests, Terraform CI contract, and staging smoke validation after
the rollback. Close SCRUM-181 only when acceptance checks pass, no forbidden
content is observed, and the reviewer has accepted sanitized evidence.
