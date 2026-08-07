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

#### `HeatRestPolicy` (JPA Entity)
Site-specific policy configuration stored in database:

```
Table: heat_rest_policy
Columns:
  - wbgt_threshold_unacclimatised_light/moderate/heavy
  - wbgt_threshold_partial_light/moderate/heavy
  - wbgt_threshold_full_light/moderate/heavy
  - wbgt_emergency_stop (override for all levels)
```

Each site must have exactly one policy (unique constraint on `site_id`).

### Services

#### `PolicyEngineService`
Main evaluation service (stateless).

**Public Method:**
```java
PolicyDecision evaluate(
    UUID siteId,
    Double currentWbgt,
    HeatRestPolicy.WorkIntensity intensity,
    int acclimatisationDay
)
```

**Decision Logic:**
1. **Emergency Stop**: If WBGT ≥ emergency threshold → `STOP_WORK`
2. **Threshold Evaluation**: If WBGT ≥ threshold for (level, intensity) → recommend rest
   - Unacclimatised + moderate/heavy → `EXTENDED_REST` (30 min)
   - Others → `SHORT_REST` (10 min)
3. **Safe Operation**: If WBGT < threshold → `CONTINUE`

**Example:**
```java
var decision = policyEngine.evaluate(
    siteId,
    28.5,                              // Current WBGT (°C)
    HeatRestPolicy.WorkIntensity.HEAVY, // Heavy work
    2                                   // Day 2 (unacclimatised)
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

#### `PolicyConfigRepository`
Spring Data JPA repository for policy queries:

```java
Optional<HeatRestPolicy> findBySiteId(UUID siteId)
boolean existsBySiteId(UUID siteId)
```

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

Administrators configure site policies via database or admin API:

```sql
INSERT INTO heat_rest_policy (
    id, site_id,
    wbgt_threshold_unacclimatised_light, -- Site-specific: 24°C (stricter than default 25°C)
    wbgt_threshold_unacclimatised_moderate,
    ...
) VALUES (...);
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

### Integration Tests (Future: `PolicyControllerIntegrationTest`)
- Testcontainers PostgreSQL with real policy data
- Cognito-local test tokens (site authorization)
- Multiple sites with different policies
- Cross-site denial scenarios

## Database Schema

Migration: `V6__heat_rest_policy.sql`

**Table:** `heat_rest_policy`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK | Auto-generated |
| `site_id` | UUID | FK, UNIQUE | One policy per site |
| `wbgt_threshold_*` | DECIMAL(5,2) | CHK >= 15 | Light >= Moderate >= Heavy per level |
| `wbgt_emergency_stop` | DECIMAL(5,2) | CHK [20, 40] | Critical threshold |
| `created_at` | TIMESTAMP | NOT NULL | Audit trail |
| `updated_at` | TIMESTAMP | NOT NULL | Audit trail |
| `notes` | TEXT | NULLABLE | Site-specific documentation |

**Indices:**
- `idx_heat_rest_policy_site_id`: Fast lookup by site

## Security & Compliance

### Authorization
- Policy evaluation is **internal** (no direct REST endpoint)
- Calling services must enforce site authorization (`@PreAuthorize("@siteAccess.canAccess(#siteId)")`)

### Data Validation
- WBGT range: [15, 40]°C (physically unrealistic outside this range)
- Acclimatisation day: [1, 365]
- Work intensity: Enum (no injection possible)
- Threshold ordering: Validated at DB level (light >= moderate >= heavy)

### Audit Trail
- Policy evaluations logged at INFO level (not per-request, too noisy)
- Policy changes (CREATE/UPDATE) logged as audit events via AuditService
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

- **ADR-002**: Heat Safety Strategy
- **ADR-013**: UTC Storage, Singapore Display Timezone
- **MOM Guidelines**: Ministry of Manpower work-rest schedules
- **SCRUM-117**: Epic requirement
- **Related**: SCRUM-122 (Shift Readiness), SCRUM-125 (Worker Rest Logging)

## Future Enhancements

- [ ] Policy caching with TTL for high-frequency evaluation
- [ ] REST endpoint to query applicable policy for a site (read-only)
- [ ] Admin endpoint to create/update policies
- [ ] Policy version history (audit trail)
- [ ] Machine learning: Adjust thresholds based on worker outcomes
- [ ] Integration with weather API for predictive decisions

## Package Structure

```
com.crewsafe.policy/
├── domain/
│   ├── AcclimatisationLevel.java      (Enum)
│   ├── PolicyDecision.java            (Record)
│   ├── RestRecommendation.java        (Record)
│   └── HeatRestPolicy.java            (JPA Entity)
├── service/
│   ├── PolicyEngineService.java       (Main service)
│   └── AcclimatisationCalculator.java (Helper)
├── repository/
│   └── PolicyConfigRepository.java    (Spring Data JPA)
└── api/
    └── (No public REST endpoint; internal service only)
```

---

**Status:** ✅ SCRUM-117 Initial Implementation  
**Date:** 2026-08-07  
**Test Coverage:** >85%  
**SonarQube Gate:** Ready for Quality Gate
