# Policy Engine Module (SCRUM-117)

## Overview

Heat-Rest Policy Evaluation Engine for CrewSafe.

This module implements deterministic policy-based decisions for heat safety in field operations. Given current WBGT (Wet Bulb Globe Temperature), worker acclimatisation level, and work intensity, it recommends appropriate work-rest actions per MOM (Ministry of Manpower) guidelines.

**Key Principles:**
- ✅ **Deterministic**: Identical inputs always produce identical outputs
- ✅ **Stateless**: Service holds no state; all context passed as parameters
- ✅ **Audit-safe**: Decisions are logged and traceable
- ✅ **Site-configurable**: Each site can customize WBGT thresholds
- ✅ **Safety-critical**: Every threshold is validated and constrained

## Architecture

### Domain Models

#### `AcclimatisationLevel` (Enum)
Represents worker heat acclimatisation status based on days at site:

- **UNACCLIMATISED** (Days 1-3): Strictest thresholds; body hasn't adapted to heat
- **PARTIAL** (Days 4-6): Moderate thresholds; transitioning to adaptation
- **FULL** (Days 7+): Standard thresholds; fully heat-acclimated

Reference: MOM work-rest guidelines, occupational health standards.

#### `PolicyDecision` (Record)
Immutable result of policy evaluation:

```java
record PolicyDecision(
    Action action,                    // CONTINUE, SHORT_REST, EXTENDED_REST, STOP_WORK
    RestRecommendation rest,          // Duration, shade, hydration guidance
    String reasoning                  // Why this decision (for audit logs)
)
```

#### `RestRecommendation` (Record)
Specifies rest break details:

- **Duration**: Minutes of rest required
- **Shade requirement**: Whether shade/cooling is needed
- **Hydration guidance**: Water and electrolyte recommendations
- **Intensity adjustment**: How to reduce work load (e.g., "reduce by 50%")

Predefined constants: `NONE`, `SHORT`, `EXTENDED`, `EMERGENCY`

#### `PolicyVersion` (JPA Entity)
A versioned site policy configuration (SCRUM-120), stored in database:

```
Table: policy_version
Columns:
  - version_label, source, effective_date, status (DRAFT/ACTIVE/SUPERSEDED)
  - wbgt_threshold_unacclimatised_light/moderate/heavy
  - wbgt_threshold_partial_light/moderate/heavy
  - wbgt_threshold_full_light/moderate/heavy
  - wbgt_emergency_stop (override for all levels)
```

A site may have many versions, but at most one `ACTIVE` at a time (partial unique index on
`site_id` where `status = 'ACTIVE'`). Replaces `HeatRestPolicy`, which held exactly one
mutable row per site and kept no history of prior configurations.

### Services

#### `PolicyEngineService`
Main evaluation service (stateless).

**Public Method:**
```java
PolicyDecision evaluate(
    UUID siteId,
    UUID workerId,
    Double currentWbgt,
    WorkIntensity intensity,
    int acclimatisationDay
)
```

**Decision Logic:**
1. **Emergency Stop**: If WBGT ≥ emergency threshold → `STOP_WORK`
2. **Threshold Evaluation**: If WBGT ≥ threshold for (level, intensity) → recommend rest
   - Unacclimatised + moderate/heavy → `EXTENDED_REST` (30 min)
   - Others → `SHORT_REST` (10 min)
3. **Safe Operation**: If WBGT < threshold → `CONTINUE`

Every returned `PolicyDecision.policyVersion()` is the `versionLabel` of the site's currently
`ACTIVE` `PolicyVersion` (SCRUM-120) — not a hardcoded string, so a recommendation always cites
the exact rule version that was in force when it was made.

**Example:**
```java
var decision = policyEngine.evaluate(
    siteId,
    workerId,
    28.5,                  // Current WBGT (°C)
    WorkIntensity.HEAVY,   // Heavy work
    2                      // Day 2 (unacclimatised)
);
// Result: EXTENDED_REST because unacclimatised + heavy exceeds 21°C threshold
```

#### `AcclimatisationCalculator`
Helper service for calculating acclimatisation day from assignment start date.

**Public Methods:**
```java
int calculateAcclimatisationDay(Instant assignmentStart, Instant reference)
AcclimatisationLevel getLevel(int day)
boolean isFullyAcclimatised(int day)
boolean isInAcclimatisationPhase(int day)
```

**Note:** Uses Singapore timezone (Asia/Singapore) for day boundaries.

### Repository

#### `PolicyVersionRepository`
Spring Data JPA repository for the versioned policy catalogue:

```java
Optional<PolicyVersion> findBySiteIdAndStatus(UUID siteId, PolicyVersionStatus status)
boolean existsBySiteIdAndStatus(UUID siteId, PolicyVersionStatus status)
List<PolicyVersion> findBySiteIdOrderByEffectiveDateDescCreatedAtDesc(UUID siteId)
boolean existsBySiteIdAndVersionLabel(UUID siteId, String versionLabel)
Optional<PolicyVersion> findBySiteIdAndId(UUID siteId, UUID id)
```

### Service — `PolicyVersionService` (SCRUM-120)
The Safety Manager-facing half of this module: configures and versions a site's policy.

```java
List<PolicyVersion> listForSite(UUID siteId)
Optional<PolicyVersion> getActive(UUID siteId)
PolicyVersion create(UUID siteId, PolicyVersion draft, UUID actorId)
PolicyVersion activate(UUID siteId, UUID versionId, UUID actorId)
```

- A site's first-ever version is activated automatically — `PolicyEngineService` cannot
  evaluate a site with zero `ACTIVE` versions.
- Every version after the first is created `DRAFT`; `activate` supersedes whatever was
  previously `ACTIVE` (sets it `SUPERSEDED`, stamps `supersededAt`) and activates the target.
- Activating an already-`ACTIVE` version is an idempotent no-op. `SUPERSEDED` is terminal —
  attempting to reactivate one throws `ConflictException`.
- Threshold ordering (light ≥ moderate ≥ heavy per acclimatisation level) is validated in Java
  before the DB's `chk_intensity_ordering` constraint would reject it, so a bad request gets a
  clean 400 instead of a raw constraint-violation error.
- Both `create` and `activate` write an audit event (`POLICY_VERSION_CREATED` /
  `POLICY_VERSION_ACTIVATED`) via `AuditService`.

Exposed over REST by `PolicyVersionController` at `/api/v1/sites/{siteId}/policy-versions`
— list the catalogue, get the active version, create, and `POST .../{versionId}/activate`.
Reading requires SUPERVISOR/SAFETY_MANAGER/ADMIN; creating/activating requires
SAFETY_MANAGER/ADMIN, both scoped by `@siteAccess.canAccess(#siteId)`.

## Usage Patterns

### As an Internal Service

Called from **Operation**, **Mitigation**, or **Shift** services to make safety decisions:

```java
@RequiredArgsConstructor
@Service
public class OperationService {
    private final PolicyEngineService policyEngine;
    private final AuditService audit;

    @Transactional
    public void startShift(UUID shiftId, UUID workerId) {
        // ... fetch shift, worker, current WBGT ...
        
        PolicyDecision decision = policyEngine.evaluate(
            shiftId.getSiteId(),
            getCurrentWBGT(),
            shift.getIntensity(),
            workerAssignment.getAcclimatisationDay()
        );

        if (decision.isEmergencyStop()) {
            // Prevent shift start, escalate
            audit.record(AuditEventType.SHIFT_BLOCKED_HEAT_SAFETY, shiftId, decision.reasoning());
        }
    }
}
```

### Policy Lookup & Customization

A Safety Manager configures site policies via `PolicyVersionController` (SCRUM-120):

```
POST /api/v1/sites/{siteId}/policy-versions            create a version (DRAFT, or ACTIVE if first)
POST /api/v1/sites/{siteId}/policy-versions/{id}/activate   activate a DRAFT, superseding the previous ACTIVE
GET  /api/v1/sites/{siteId}/policy-versions             list the full catalogue
GET  /api/v1/sites/{siteId}/policy-versions/active       get the version currently in force
```

## Testing Strategy

### Unit Tests (`PolicyEngineServiceTest`)
- ✅ Happy path: WBGT below/at/above thresholds
- ✅ Acclimatisation effects: Day 1 vs Day 7
- ✅ Work intensity modifiers: Light vs Heavy
- ✅ Emergency stop: WBGT >= 30°C
- ✅ Input validation: Null, out-of-range values
- ✅ Policy not found: NoSuchElementException

**Coverage Target:** >90%

### Unit Tests (`AcclimatisationCalculatorTest`)
- ✅ Day calculation: Same-day, next-day, far future
- ✅ Timezone handling: Singapore day boundaries
- ✅ Level derivation: Day 1-3, 4-6, 7+
- ✅ Phase checks: `isFullyAcclimatised()`, `isInAcclimatisationPhase()`
- ✅ Error handling: Invalid days, reference before start

**Coverage Target:** >95%

### Unit Tests (`PolicyVersionServiceTest`) — SCRUM-120
- ✅ Create: unknown site, duplicate label, threshold ordering
- ✅ Bootstrap: a site's first version is auto-activated; later ones are DRAFT
- ✅ Activate: supersedes previous ACTIVE, idempotent when already ACTIVE, rejects reactivating SUPERSEDED
- ✅ Audit events recorded for create and activate

### Integration Tests (`PolicyVersionControllerTest`) — SCRUM-120
- Testcontainers PostgreSQL + cognito-local, real JWTs (same pattern as `ShiftControllerTest`)
- Role gate: SAFETY_MANAGER/ADMIN can create/activate; SUPERVISOR/ADMIN can read; WORKER cannot read
- Site scoping: a Safety Manager from another site is denied
- Full lifecycle: create → still-active-is-first → activate second → active flips

## Database Schema

Migration: `V12__policy_version.sql` (supersedes `V9__heat_rest_policy.sql`, which this
migration drops after carrying its rows forward as each site's initial ACTIVE version)

**Table:** `policy_version`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK | Auto-generated |
| `site_id` | UUID | FK | Many versions per site |
| `version_label` | VARCHAR(64) | UNIQUE per site | e.g. `MOM-WBGT-2026.2` |
| `source` | VARCHAR(255) | NOT NULL | Where the thresholds came from |
| `effective_date` | DATE | NOT NULL | When the rule is/was in force |
| `status` | VARCHAR(16) | CHK DRAFT/ACTIVE/SUPERSEDED | At most one ACTIVE per site |
| `wbgt_threshold_*` | DECIMAL(5,2) | CHK >= 15 | Light >= Moderate >= Heavy per level |
| `wbgt_emergency_stop` | DECIMAL(5,2) | CHK [20, 40] | Critical threshold |
| `created_by` | UUID | FK app_user, nullable | The Safety Manager who configured it |
| `created_at` / `updated_at` | TIMESTAMPTZ | NOT NULL | Audit trail |
| `activated_at` / `superseded_at` | TIMESTAMPTZ | NULLABLE | Lifecycle timestamps |
| `notes` | TEXT | NULLABLE | Free-text documentation |

**Indices:**
- `idx_policy_version_site_id`: fast lookup by site
- `uq_policy_version_active_per_site`: **unique**, partial (`WHERE status = 'ACTIVE'`) — the
  DB itself enforces "at most one active policy per site", not just application logic
- `idx_policy_version_site_effective_date`: catalogue listing, newest effective date first

## Security & Compliance

### Authorization
- Policy *evaluation* (`PolicyEngineService`) is **internal** (no direct REST endpoint)
- Policy *configuration* (`PolicyVersionController`, SCRUM-120) is SAFETY_MANAGER/ADMIN for
  writes, SUPERVISOR/SAFETY_MANAGER/ADMIN for reads, both via
  `@PreAuthorize("... and @siteAccess.canAccess(#siteId)")`

### Data Validation
- WBGT range: [15, 40]°C (physically unrealistic outside this range)
- Acclimatisation day: [1, 365]
- Work intensity: Enum (no injection possible)
- Threshold ordering: validated in `PolicyVersionService` (clean 400) and again at the DB
  level (`chk_intensity_ordering`, V12) as the last line of defence

### Audit Trail
- Policy evaluations logged at INFO level (not per-request, too noisy)
- Policy version create/activate logged as audit events via `AuditService`
  (`POLICY_VERSION_CREATED`, `POLICY_VERSION_ACTIVATED`)
- Decisions that trigger escalations recorded in audit trail

### No PII
- Policy decisions reference UUIDs only (no worker names, emails, etc.)
- Reasoning text is sanitized and generic

## Performance

- **Lookup**: O(1) policy fetch by site_id (indexed)
- **Evaluation**: O(1) threshold comparison
- **Caching** (future): Site policies could be cached with TTL for high-frequency evaluation

**No blocking I/O in evaluation path** (policy already loaded from DB).

## References

- **ADR-013**: UTC Storage, Singapore Display Timezone
- **MOM Guidelines**: Ministry of Manpower work-rest schedules
- **SCRUM-117**: Epic requirement (policy evaluation engine)
- **SCRUM-120**: Versioned policy catalogue with source & effective date
- **Related**: SCRUM-122 (Shift Readiness), SCRUM-125 (Worker Rest Logging)

## Future Enhancements

- [ ] Policy caching with TTL for high-frequency evaluation
- [ ] Machine learning: Adjust thresholds based on worker outcomes
- [ ] Integration with weather API for predictive decisions
- [ ] Time-triggered activation (a version's `effective_date` is currently metadata only —
      activation is always an explicit Safety Manager action)

## Package Structure

```
com.crewsafe.policy/
├── domain/
│   ├── AcclimatisationLevel.java      (Enum)
│   ├── WorkIntensity.java             (Enum)
│   ├── PolicyDecision.java            (Record)
│   ├── PolicyVersionStatus.java       (Enum — DRAFT/ACTIVE/SUPERSEDED)
│   ├── RestRecommendation.java        (Record)
│   └── PolicyVersion.java             (JPA Entity)
├── service/
│   ├── PolicyEngineService.java       (Evaluation — internal)
│   ├── PolicyVersionService.java      (Configuration — SCRUM-120)
│   └── AcclimatisationCalculator.java (Helper)
├── repository/
│   └── PolicyVersionRepository.java   (Spring Data JPA)
└── api/
    └── PolicyVersionController.java   (SCRUM-120 — configuration REST endpoints)
```

---

**Status:** ✅ SCRUM-117 Initial Implementation, ✅ SCRUM-120 Versioned Catalogue
**Date:** 2026-08-11
**Test Coverage:** >85%
