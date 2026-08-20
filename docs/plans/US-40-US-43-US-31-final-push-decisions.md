# US-40 / US-43 / US-31 — final-push documentation decisions

**Status:** Documentation only

**Evidence baseline:** `main` at `8f2b6e940839a2a34e96ed38432f7a1879b15dbf`

**Recorded:** 2026-08-20

This note closes the final-push documentation item without adding runtime behavior. It distinguishes behavior implemented in the repository from deferred work and policy decisions that still require team confirmation.

## Status vocabulary

- **Implemented** — present in current-main code or infrastructure configuration.
- **Deferred** — intentionally not implemented or evidenced in this item.
- **Team confirmation required** — no adopted value or policy was found in current-main documentation; the team must decide and approve it before it can be represented as policy.

## US-40 — frame the existing stop-work auto-dispatch behavior

### Implemented behavior

The existing automatic stop-work path is driven by the live lightning state:

1. `RecommendationAutoTriggerService` detects a configured recommendation trigger and calls `AgentDraftService.generateAuto(...)`.
2. `AgentDraftService` creates the deterministic lightning plan when the live lightning state is `STOP_WORK`, persists it with status `AUTO_DISPATCHED`, records `RECOMMENDATION_AUTO_DISPATCHED`, and invokes `RecommendationService.autoDispatch(...)` after commit.
3. `RecommendationService.autoDispatch(...)` fans each mitigation out to workers in the target shift without an approval record.
4. `ActionDispatchService.autoDispatchAction(...)` creates each linked action dispatch with status `PENDING` and records `ACTION_AUTO_DISPATCHED`.

The implementation is configuration-gated: `RecommendationAutoTriggerScheduler` only runs when `app.recommendation.auto-trigger.enabled=true`. This note does not assert that the scheduler is enabled in any deployed environment.

Heat and lightning are deliberately different paths. `PolicyEngineService` ignores the legacy `wbgtEmergencyStop` compatibility field and derives heat mitigations from WBGT bands. A heat-only or model-suggested `STOP_WORK` action does not qualify for automatic dispatch; the current automatic stop-work condition is the live lightning `STOP_WORK` state.

### Boundary of US-40

US-40 is satisfied here by framing the existing immediate auto-dispatch behavior. This item does **not** add:

- an acknowledgement deadline or escalation timer;
- an EventBridge rule or timer;
- ST-13 escalation behavior;
- automatic expiry of recommendations or dispatches; or
- a new heat-triggered stop-work path.

`ActionDispatchSweepScheduler` can mark dispatches late and auto-complete acknowledged dispatches when separately enabled. That existing sweep is not an unacknowledged stop-work escalation timer. Lightning-risk validity/expiry also describes the validity of lightning observations; it is not a US-40 escalation deadline.

If the product requires a later rule such as “escalate an unacknowledged stop-work action after N minutes,” that is a separate behavior and policy decision requiring acceptance criteria, ownership, and an approved time threshold.

### Repository evidence

- `backend/src/main/java/com/crewsafe/operation/service/AgentDraftService.java`
- `backend/src/main/java/com/crewsafe/operation/service/RecommendationService.java`
- `backend/src/main/java/com/crewsafe/operation/service/RecommendationAutoTriggerService.java`
- `backend/src/main/java/com/crewsafe/operation/service/RecommendationAutoTriggerScheduler.java`
- `backend/src/main/java/com/crewsafe/operation/service/ActionDispatchService.java`
- `backend/src/main/java/com/crewsafe/operation/service/ActionDispatchSweepScheduler.java`
- `backend/src/main/java/com/crewsafe/policy/service/PolicyEngineService.java`

## US-43 — PDPA/data-retention decision schedule

### Implemented technical controls

These are current technical behaviors, not an adopted PDPA retention schedule:

| Area | Current-main behavior | Classification |
| --- | --- | --- |
| Audit events | Database trigger rejects `UPDATE` and `DELETE` on `audit_event`. | Implemented, append-only |
| Users | Application users can be made inactive; no application-user erasure workflow was found. Cognito identity lifecycle is separate. | Implemented status control; erasure policy not established |
| Sites | Sites are archived/unarchived rather than deleted. | Implemented lifecycle control |
| Shifts | A shift can be hard-deleted after its assignments; the deletion is audited. Readiness and wellbeing records retain their bare shift UUID. | Implemented behavior |
| Application safety/health records | No time-based purge was found for readiness submissions, wellbeing logs, concerns, recommendations, approvals, action dispatches, or sensor/weather/lightning observations. | No automatic retention disposal implemented |
| RDS automated backups | Terraform default is 7 days and permits 7–35 days. | Implemented infrastructure setting; deployed value not asserted here |
| RDS PostgreSQL logs | Terraform config retains the CloudWatch log group for 30 days. | Implemented infrastructure setting |
| Backend and ML application logs | Terraform default retention is 14 days. | Implemented infrastructure setting; deployed value not asserted here |
| Compute access logs | S3 lifecycle expires access-log objects after 30 days. | Implemented infrastructure setting |
| Database deletion | Deletion protection is enabled and a final snapshot is required; no final-snapshot expiry is defined. | Implemented protection; retention endpoint not established |

Evidence:

- `backend/src/main/resources/db/migration/V5__audit_event_append_only.sql`
- `backend/src/main/java/com/crewsafe/user/`
- `backend/src/main/java/com/crewsafe/site/`
- `backend/src/main/java/com/crewsafe/shift/`
- `backend/src/main/java/com/crewsafe/readiness/`
- `backend/src/main/java/com/crewsafe/wellbeing/`
- `backend/src/main/java/com/crewsafe/operation/`
- `infra/terraform/database/main.tf`
- `infra/terraform/database/variables.tf`
- `infra/terraform/compute/main.tf`
- `infra/terraform/compute/variables.tf`

### Policy schedule requiring team confirmation

No approved business-record retention periods were found in current main. The following schedule therefore records decisions still required; `TBD` is intentional and must not be replaced by an assumed period.

| Data class | Examples | Retention/disposal decision | Required confirmation |
| --- | --- | --- | --- |
| Identity and profile | Cognito subject, username, display name, email, application status | **TBD — team confirmation required** | Retention after deactivation; Cognito deletion coordination; anonymisation/erasure method |
| Readiness and wellbeing | Readiness submissions, wellbeing logs, worker concerns and acknowledgements | **TBD — team confirmation required** | Operational need, access restriction, retention period, disposal/anonymisation method |
| Work allocation | Sites, memberships, shifts, assignments | **TBD — team confirmation required** | Archive versus delete rules and dependencies on safety records |
| Safety decisions and actions | Recommendations, approvals, mitigations, dispatches, acknowledgement history | **TBD — team confirmation required** | Safety/audit retention need, retention period, late or incomplete action treatment |
| Audit trail | Append-only audit events | **TBD — team confirmation required** | Required retention period, lawful disposal path, and any legal/audit hold process |
| Conditions and sensor data | Weather and lightning observations, site conditions | **TBD — team confirmation required** | Whether records are personal or linkable in context, retention period, aggregation/disposal method |
| Backups and final snapshots | RDS automated backups and final snapshots | **TBD — team confirmation required** | Approved backup window, final-snapshot owner/expiry, restoration copies, disposal evidence |
| Operational logs | Application, database, and access logs | **TBD — team confirmation required** | Confirm configured periods meet policy; define incident/legal hold exceptions |

Before adopting the schedule, the team must also confirm the policy owner, approval date, scope, effective date, deletion/anonymisation process, exception/hold process, evidence of disposal, and responsibility for periodic review. The repository’s current controls do not by themselves establish or prove PDPA compliance.

Automatic record expiry or purge logic is outside this documentation item and is not implemented here.

## US-31 — performance work deferred to ADR-0021

The governing decision is the document titled **ADR 0021 — Accessibility tooling: vitest-axe now, jsx-a11y & Lighthouse CI deferred**, stored at:

- `docs/adr/0022-accessibility-tooling-vitest-axe-now-lighthouse-jsx-a11y-deferred.md`

The filename number and title number differ; this note uses the ADR title as the decision identifier and gives the exact path to avoid ambiguity.

Current status:

- `vitest-axe` accessibility tests are the implemented near-term control described by the ADR.
- `eslint-plugin-jsx-a11y` remains deferred until its supported ESLint peer range is compatible with the project.
- Lighthouse CI remains deferred because the evaluated package brought unsuitable transitive vulnerabilities and because Lighthouse belongs in CI against a running application rather than inside unit tests.
- The US-31 read-performance target (`p95 < 1s`) remains deferred with that work.
- No Lighthouse run, load test, or p95 measurement was executed for this documentation item; therefore no performance result is claimed.

Any later US-31 implementation must define the representative read path, workload, environment, data volume, warm-up, sample size, and percentile calculation before the p95 acceptance target can be evaluated reproducibly.

## Explicitly out of scope

This documentation-only item does not build or authorize US-38, US-41, ST-13, EventBridge timers, stop-work escalation timers, or automatic expiry/purge behavior.
