# WBGT CrewSafe SG - SpringBoot Backend Implementation Roadmap

**Document Date:** 29 July 2026  
**Status:** Initial Analysis & Feature Planning  
**Target:** Amazon Cognito Integration for Authentication & Authorization

---

## Executive Summary

The backend is a Spring Boot microservice that serves as the **system of record** for WBGT CrewSafe SG. Based on the AD Project Plan, the backend must implement:

1. **Authentication & Authorization** via Amazon Cognito
2. **Core Data Models** (Users, Sites, Shifts, Workers, Tasks, Assignments)
3. **Weather & Forecast Integration** (NEA WBGT, Weather, Lightning APIs)
4. **Policy Engine** (Deterministic safety rules)
5. **Recommendation & Approval Workflow** (Agent-generated plans)
6. **Audit & Compliance** (Immutable event logging)
7. **Dashboard APIs** (Live conditions, compliance metrics, ML performance)
8. **Real-time Updates** (Server-Sent Events or WebSocket)

---

## Part 1: Features That CAN Be Done (MVP Scope)

### 1.1 Authentication & Authorization with Amazon Cognito

**Status:** Must Have (Sprint 1)  
**Complexity:** Medium  
**Effort:** 8-13 points

#### What to implement:
- [ ] **Cognito User Pool Setup**
  - Create User Pool in AWS Cognito
  - Configure password policies
  - Enable MFA (optional for MVP)
  - Create App Client with OAuth 2.0 / OpenID Connect flows

- [ ] **Spring Security Integration**
  - Add Spring Security with OAuth 2.0 Resource Server configuration
  - Configure JWT token validation (validate signatures from Cognito)
  - Implement JWT token claims extraction (user ID, roles, site memberships)
  - Add `@EnableGlobalMethodSecurity` for role-based access

- [ ] **Login Endpoint**
  ```
  POST /api/v1/auth/login
  {
    "username": "worker@example.com",
    "password": "secure_password"
  }
  ```
  Response: Access token, ID token, Refresh token from Cognito

- [ ] **Current User Endpoint**
  ```
  GET /api/v1/me
  Authorization: Bearer <access_token>
  ```
  Returns: User profile, assigned sites, roles

- [ ] **Refresh Token Endpoint**
  ```
  POST /api/v1/auth/refresh
  {
    "refreshToken": "..."
  }
  ```

- [ ] **Role-Based Access Control (RBAC)**
  - **Roles:** Worker, Supervisor, Safety Manager, Administrator
  - Implement role mapping from Cognito User Groups or token claims
  - Enforce via Spring Security annotations: `@PreAuthorize("hasRole('SUPERVISOR')")`
  - Server-side authorization on all endpoints

- [ ] **Site-Scoped Access**
  - Users can only access sites they're assigned to
  - Implement `@PostAuthorize` filters for site visibility
  - Prevent lateral movement between sites

#### Technology Stack:
```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-security</artifactId>
    <version>3.x</version>
</dependency>
<dependency>
    <groupId>org.springframework.security</groupId>
    <artifactId>spring-security-oauth2-resource-server</artifactId>
    <version>6.x</version>
</dependency>
<dependency>
    <groupId>org.springframework.security</groupId>
    <artifactId>spring-security-oauth2-jose</artifactId>
    <version>6.x</version>
</dependency>
```

#### Cognito Configuration:
```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: https://cognito-idp.{region}.amazonaws.com/{userPoolId}
          jwk-set-uri: https://cognito-idp.{region}.amazonaws.com/{userPoolId}/.well-known/jwks.json
```

---

### 1.2 Core Data Models & Persistence

**Status:** Must Have (Sprint 1)  
**Complexity:** Medium  
**Effort:** 13-21 points

#### Models to implement:

- [ ] **User Entity**
  ```java
  @Entity
  public class User {
    @Id private UUID id;
    private String cognitoSubject; // Cognito subject claim
    private String displayName;
    private String email;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    @OneToMany
    private List<SiteMembership> siteMemberships;
  }
  ```

- [ ] **Site Entity**
  ```java
  @Entity
  public class Site {
    @Id private UUID id;
    private String name;
    private BigDecimal latitude;
    private BigDecimal longitude;
    private String timezone; // e.g., "Asia/Singapore"
    private LocalDateTime createdAt;
  }
  ```

- [ ] **SiteMembership Entity**
  ```java
  @Entity
  public class SiteMembership {
    @Id private UUID id;
    @ManyToOne private User user;
    @ManyToOne private Site site;
    private String role; // SUPERVISOR, WORKER, MANAGER, ADMIN
    private LocalDateTime assignedAt;
  }
  ```

- [ ] **Task Entity**
  ```java
  @Entity
  public class Task {
    @Id private UUID id;
    private String name; // e.g., "Landscaping", "Grounds Maintenance"
    private String description;
    @ManyToOne private Site site;
  }
  ```

- [ ] **Shift Entity**
  ```java
  @Entity
  public class Shift {
    @Id private UUID id;
    @ManyToOne private Site site;
    private LocalDateTime startsAt;
    private LocalDateTime endsAt;
    private String status; // PLANNED, ACTIVE, CLOSED
    private LocalDateTime createdAt;
    @OneToMany
    private List<ShiftAssignment> assignments;
  }
  ```

- [ ] **ShiftAssignment Entity**
  ```java
  @Entity
  public class ShiftAssignment {
    @Id private UUID id;
    @ManyToOne private Shift shift;
    @ManyToOne private User worker;
    @ManyToOne private Task task;
    private String intensity; // LIGHT, MODERATE, HEAVY
    private Integer acclimatisationDay; // 1-7, null if acclimatised
    private LocalDateTime createdAt;
  }
  ```

- [ ] **ReadinessCheck Entity**
  ```java
  @Entity
  public class ReadinessCheck {
    @Id private UUID id;
    @ManyToOne private ShiftAssignment assignment;
    private Boolean isNewOrReturning; // true if within 7-day acclimatisation
    private Boolean isUnwell;
    private Boolean canPerformSafely;
    private LocalDateTime submittedAt;
  }
  ```

- [ ] **WeatherObservation Entity**
  ```java
  @Entity
  public class WeatherObservation {
    @Id private UUID id;
    @ManyToOne private Site site;
    private BigDecimal wbgt; // Wet Bulb Globe Temperature
    private BigDecimal temperature;
    private BigDecimal humidity;
    private BigDecimal windSpeed;
    private BigDecimal rainfall;
    private LocalDateTime observedAt;
    private LocalDateTime ingestedAt;
    private String source; // "NEA", "MANUAL", "CACHED"
    private String qualityStatus; // "LIVE", "DELAYED", "STALE", "SIMULATED"
    private String stationId;
  }
  ```

- [ ] **WBGTForecast Entity**
  ```java
  @Entity
  public class WBGTForecast {
    @Id private UUID id;
    @ManyToOne private Site site;
    private BigDecimal wbgt30m;
    private BigDecimal wbgt60m;
    private String modelVersion; // e.g., "1.0", "1.1"
    private LocalDateTime generatedAt;
    private String mode; // "LIVE", "FALLBACK"
    private BigDecimal confidence;
  }
  ```

- [ ] **LightningObservation Entity**
  ```java
  @Entity
  public class LightningObservation {
    @Id private UUID id;
    @ManyToOne private Site site;
    private LocalDateTime strikeTime;
    private BigDecimal latitude;
    private BigDecimal longitude;
    private BigDecimal distance; // Distance from site center
    private String type; // "CLOUD_TO_GROUND", "CLOUD_TO_CLOUD"
    private LocalDateTime ingestedAt;
  }
  ```

- [ ] **PolicyVersion Entity**
  ```java
  @Entity
  public class PolicyVersion {
    @Id private UUID id;
    private String version; // e.g., "MOM-WBGT-2026.1"
    private String name;
    @Lob private String rules; // JSON or serialized rules
    private LocalDateTime effectiveFrom;
    private LocalDateTime effectiveTo; // null if current
    private Boolean isActive;
    private LocalDateTime createdAt;
  }
  ```

- [ ] **Recommendation Entity**
  ```java
  @Entity
  public class Recommendation {
    @Id private UUID id;
    @ManyToOne private Shift shift;
    @ManyToOne private PolicyVersion policyVersion;
    @Lob private String draftPlan; // JSON from agent
    private String status; // DRAFT, PENDING_APPROVAL, APPROVED, REJECTED
    private String rationale;
    private LocalDateTime createdAt;
    @OneToOne(mappedBy = "recommendation")
    private Approval approval;
  }
  ```

- [ ] **Approval Entity**
  ```java
  @Entity
  public class Approval {
    @Id private UUID id;
    @OneToOne private Recommendation recommendation;
    @ManyToOne private User approver;
    private String decision; // APPROVED, REJECTED, EDITED
    private String reason;
    @Lob private String editedPlan; // If decision is EDITED
    private LocalDateTime decidedAt;
  }
  ```

- [ ] **ActionDispatch Entity**
  ```java
  @Entity
  public class ActionDispatch {
    @Id private UUID id;
    @ManyToOne private Approval approval;
    @ManyToOne private User worker;
    private String actionCode; // "REST_10_MIN_HOURLY", "HYDRATE", "STOP_WORK"
    private String instruction;
    private LocalDateTime startTime;
    private LocalDateTime endTime;
    private String status; // "PENDING", "ACKNOWLEDGED", "COMPLETED"
    private LocalDateTime dispatchedAt;
  }
  ```

- [ ] **Acknowledgement Entity**
  ```java
  @Entity
  public class Acknowledgement {
    @Id private UUID id;
    @ManyToOne private ActionDispatch actionDispatch;
    @ManyToOne private User worker;
    private LocalDateTime acknowledgedAt;
    @Column(unique = true)
    private String idempotencyKey; // For idempotent requests
  }
  ```

- [ ] **SafetyEvent Entity**
  ```java
  @Entity
  public class SafetyEvent {
    @Id private UUID id;
    @ManyToOne private Shift shift;
    @ManyToOne private User reporter;
    private String eventType; // "CONCERN", "HEAT_ILLNESS", "EQUIPMENT_ISSUE"
    private String description;
    private String severity; // "LOW", "MEDIUM", "HIGH"
    private String status; // "OPEN", "ACKNOWLEDGED", "RESOLVED"
    private LocalDateTime reportedAt;
    private LocalDateTime resolvedAt;
  }
  ```

- [ ] **AuditEvent Entity** (Append-only)
  ```java
  @Entity
  public class AuditEvent {
    @Id private UUID id;
    @ManyToOne private User actor;
    private String eventType; // "RECOMMENDATION_CREATED", "APPROVAL_GIVEN", "ACTION_DISPATCHED"
    private String targetType; // "Recommendation", "Shift", "User"
    private UUID targetId;
    @Lob private String details; // JSON with full context
    private LocalDateTime occurredAt;
  }
  ```

#### JPA Repositories:
Create Spring Data JPA repositories for all entities:
```java
public interface UserRepository extends JpaRepository<User, UUID> {
  Optional<User> findByCognitoSubject(String cognitoSubject);
  Optional<User> findByEmail(String email);
}

public interface ShiftRepository extends JpaRepository<Shift, UUID> {
  List<Shift> findBySiteIdAndStatusOrderByStartsAtDesc(UUID siteId, String status);
}

// Similar for all other entities
```

#### Database:
- Use **PostgreSQL** (as per project plan)
- Enable UUID as primary key type
- Add indexes on frequently queried columns
- Implement database constraints for referential integrity
- Use Flyway or Liquibase for schema migration

---

### 1.3 Policy Engine (Deterministic Safety Rules)

**Status:** Must Have (Sprint 2)  
**Complexity:** High  
**Effort:** 13-21 points

#### What to implement:

- [ ] **Policy Rule Structure**
  ```java
  public class PolicyRule {
    private String ruleId; // "HS-32-HEAVY", "HS-31-RESCHEDULE"
    private String wbgtBand;
    private String taskIntensity;
    private String actionCode;
    private String description;
    private String sourceReference; // MOM source URL
  }
  ```

- [ ] **Policy Evaluation Service**
  ```java
  @Service
  public class PolicyEvaluationService {
    public PolicyEvaluation evaluate(PolicyContext context) {
      // Inputs: WBGT band, task intensity, acclimatisation day
      // Output: mandatory actions, advisory actions, matched rules
      // WBGT 32-33°C + HEAVY = 10-minute hourly rest
      // WBGT 33°C+ + HEAVY = 15-minute hourly rest
      // New/returning worker = acclimatisation restrictions
    }
  }
  ```

- [ ] **WBGT Band Classification**
  ```java
  public enum WBGTBand {
    BELOW_31("Below 31°C"),
    FROM_31_TO_32("31°C to below 32°C"),
    FROM_32_TO_33("32°C to below 33°C"),
    FROM_33_AND_ABOVE("33°C and above");
    
    public static WBGTBand fromTemperature(BigDecimal wbgt) {
      if (wbgt.compareTo(new BigDecimal("31")) < 0) return BELOW_31;
      // ... classify based on thresholds
    }
  }
  ```

- [ ] **Lightning Risk Assessment**
  ```java
  public enum LightningRisk {
    CLEAR,      // No strikes nearby
    ADVISORY,   // Possible risk, continue with caution
    STOP_WORK   // Immediate threat, cease work
    
    public static LightningRisk assess(List<LightningObservation> strikes, Site site) {
      // Calculate distance from nearest strike
      // If < 5km in last 30 min: STOP_WORK
      // If < 10km in last 60 min: ADVISORY
      // Otherwise: CLEAR
    }
  }
  ```

- [ ] **Policy Configuration API**
  ```
  PUT /api/v1/policies/{policyVersionId}
  {
    "version": "MOM-WBGT-2026.2",
    "rules": [
      {
        "wbgtBand": "32_TO_BELOW_33",
        "taskIntensity": "HEAVY",
        "mandatoryActions": ["REST_10_MIN_HOURLY", "HYDRATE_HOURLY"]
      }
    ]
  }
  ```

---

### 1.4 Weather & Forecast Integration

**Status:** Must Have (Sprint 1-2)  
**Complexity:** Medium  
**Effort:** 13-21 points

#### What to implement:

- [ ] **NEA WBGT Ingestion Service**
  ```java
  @Service
  public class NEAWeatherService {
    public void ingestLatestObservations(UUID siteId) {
      // Call NEA API to fetch latest WBGT for each site
      // Store in WeatherObservation with freshness timestamp
      // Deduplicate on observation time + station
    }
  }
  ```

- [ ] **Lightning Observation Ingestion**
  ```java
  @Service
  public class NEALightningService {
    public LightningRisk assessSiteRisk(UUID siteId) {
      // Fetch recent lightning strikes from NEA
      // Calculate distance from site center
      // Return CLEAR / ADVISORY / STOP_WORK
    }
  }
  ```

- [ ] **Scheduled Data Refresh**
  ```java
  @Component
  public class WeatherScheduledTasks {
    @Scheduled(fixedDelay = 15 * 60 * 1000) // Every 15 minutes
    public void refreshWeatherForAllSites() {
      // For each active site, ingest latest observations
      // Mark stale observations
      // Trigger policy re-evaluation if band changes
    }
  }
  ```

- [ ] **ML Service Integration**
  ```java
  @Service
  public class MLForecastService {
    public WBGTForecast getForecast(UUID siteId) {
      // Call internal ML service at /predict
      // Pass recent observations as features
      // Return 30-minute and 60-minute predictions
      // Fallback to persistence forecast if ML unavailable
    }
  }
  ```

- [ ] **Data Freshness & Status API**
  ```
  GET /api/v1/sites/{siteId}/conditions
  
  Response:
  {
    "currentWbgt": 32.2,
    "wbgtBand": "32_TO_BELOW_33",
    "forecast30m": 32.7,
    "forecast60m": 33.1,
    "forecastBand60m": "33_AND_ABOVE",
    "observedAt": "2026-07-29T14:00:00Z",
    "ingestedAt": "2026-07-29T14:01:30Z",
    "freshnessStatus": "LIVE",
    "source": "NEA",
    "lightningRisk": "CLEAR",
    "modelVersion": "1.0"
  }
  ```

---

### 1.5 Recommendation & Approval Workflow

**Status:** Must Have (Sprint 2)  
**Complexity:** High  
**Effort:** 21-34 points

#### What to implement:

- [ ] **Draft Generation Endpoint**
  ```
  POST /api/v1/shifts/{shiftId}/recommendations/generate
  Authorization: Bearer <token> (Supervisor or System)
  
  Response:
  {
    "recommendationId": "rec-123",
    "status": "PENDING_APPROVAL",
    "policyVersion": "MOM-WBGT-2026.1",
    "currentWbgtBand": "32_TO_BELOW_33",
    "forecastBand": "33_AND_ABOVE",
    "proposedActions": [
      {
        "code": "REST_10_MIN_HOURLY",
        "appliesTo": ["worker-1", "worker-2"],
        "ruleReference": "HS-32-HEAVY",
        "reasoning": "Current WBGT in 32-33°C band with heavy work"
      }
    ],
    "createdAt": "2026-07-29T14:05:00Z"
  }
  ```

- [ ] **Policy Evaluation Call**
  ```java
  @Service
  public class RecommendationService {
    public Recommendation generateDraft(UUID shiftId) {
      Shift shift = shiftRepository.findById(shiftId).orElseThrow();
      Site site = shift.getSite();
      
      // Fetch current conditions
      WeatherObservation current = weatherRepository
        .findLatestBySite(site.getId());
      WBGTForecast forecast = forecastRepository
        .findLatestBySite(site.getId());
      LightningRisk lightning = lightningService.assessRisk(site);
      
      // Build evaluation context
      PolicyContext context = PolicyContext.builder()
        .currentWbgt(current.getWbgt())
        .forecastWbgt30m(forecast.getWbgt30m())
        .forecastWbgt60m(forecast.getWbgt60m())
        .workers(shift.getAssignments())
        .lightningRisk(lightning)
        .build();
      
      // Evaluate policy
      PolicyEvaluation evaluation = policyEngine.evaluate(context);
      
      // Create recommendation
      Recommendation rec = new Recommendation();
      rec.setShift(shift);
      rec.setStatus("DRAFT");
      rec.setDraftPlan(serializeEvaluation(evaluation));
      rec.setPolicyVersion(getPolicyVersion());
      
      return recommendationRepository.save(rec);
    }
  }
  ```

- [ ] **Approval Endpoint**
  ```
  POST /api/v1/recommendations/{recommendationId}/decision
  Authorization: Bearer <token> (Supervisor only)
  
  {
    "decision": "APPROVED",
    "reason": "Approved as proposed",
    "editedPlan": null
  }
  ```

- [ ] **Edit Workflow**
  - Supervisor can modify proposed actions before approval
  - Original draft and edited version both stored
  - Both versions appear in audit trail

- [ ] **Rejection Workflow**
  - Supervisor can reject without dispatch
  - No worker actions created
  - Decision recorded in audit

- [ ] **Timeout Escalation** (Stretch)
  ```java
  @Component
  public class ApprovalEscalationTask {
    @Scheduled(fixedDelay = 5 * 60 * 1000) // Every 5 minutes
    public void checkPendingStopWorkRecommendations() {
      // Find recommendations with status="PENDING_APPROVAL"
      // Check if they contain STOP_WORK action
      // If pending > configured timeout (e.g., 15 minutes)
      // Notify safety manager, audit escalation
    }
  }
  ```

---

### 1.6 Action Dispatch & Acknowledgement

**Status:** Must Have (Sprint 2)  
**Complexity:** Medium  
**Effort:** 13-21 points

#### What to implement:

- [ ] **Dispatch Endpoint** (Called internally after approval)
  ```java
  @Service
  public class ActionDispatchService {
    @Transactional
    public void dispatchApprovedPlan(UUID approvalId) {
      Approval approval = approvalRepository.findById(approvalId).orElseThrow();
      
      for (String workerId : approval.getAffectedWorkers()) {
        for (String actionCode : approval.getActions()) {
          ActionDispatch dispatch = new ActionDispatch();
          dispatch.setApproval(approval);
          dispatch.setWorker(userRepository.findById(workerId).orElseThrow());
          dispatch.setActionCode(actionCode);
          dispatch.setStatus("PENDING");
          dispatch.setDispatchedAt(LocalDateTime.now());
          
          dispatchRepository.save(dispatch);
          
          // Notify worker via SSE or polling
          notificationService.notifyWorker(workerId, dispatch);
        }
      }
    }
  }
  ```

- [ ] **Worker Actions Endpoint**
  ```
  GET /api/v1/me/actions
  Authorization: Bearer <token>
  
  Response:
  [
    {
      "actionId": "action-123",
      "actionCode": "REST_10_MIN_HOURLY",
      "instruction": "Take a 10-minute rest break",
      "effectiveFrom": "2026-07-29T14:30:00Z",
      "effectiveUntil": "2026-07-29T15:30:00Z",
      "status": "PENDING",
      "createdAt": "2026-07-29T14:25:00Z"
    }
  ]
  ```

- [ ] **Acknowledgement Endpoint**
  ```
  POST /api/v1/actions/{actionId}/acknowledge
  Authorization: Bearer <token>
  
  {
    "idempotencyKey": "idempotency-key-123"
  }
  
  Response: 201 Created
  ```
  - Use idempotency key to prevent duplicate acknowledgements
  - Unique constraint in database on (actionId, idempotencyKey)
  - Return 200 OK if already acknowledged (idempotent)

- [ ] **Completion Types**
  ```
  POST /api/v1/actions/{actionId}/complete
  
  {
    "completionType": "REST" | "HYDRATION" | "OTHER",
    "idempotencyKey": "..."
  }
  ```

- [ ] **Server-Sent Events (SSE) for Supervisors**
  ```java
  @GetMapping("/api/v1/sites/{siteId}/live-updates")
  public SseEmitter streamUpdates(@PathVariable UUID siteId) {
    SseEmitter emitter = new SseEmitter();
    // Subscribe to Shift, ActionDispatch, Acknowledgement events
    // Emit updates as they occur
    return emitter;
  }
  ```

---

### 1.7 Dashboard & Reporting APIs

**Status:** Must Have (Sprint 3)  
**Complexity:** Medium-High  
**Effort:** 13-21 points

#### What to implement:

- [ ] **Live Site Dashboard Endpoint**
  ```
  GET /api/v1/sites/{siteId}/dashboard
  Authorization: Bearer <token> (Supervisor/Manager)
  
  Response:
  {
    "lightningRisk": "CLEAR",
    "currentWbgt": 32.2,
    "wbgtBand": "32_TO_BELOW_33",
    "forecast30m": 32.7,
    "forecast60m": 33.1,
    "freshnessStatus": "LIVE",
    "activeShift": {
      "shiftId": "shift-123",
      "startsAt": "2026-07-29T08:00:00Z",
      "endsAt": "2026-07-29T16:00:00Z",
      "workerCount": 3,
      "taskIntensityDistribution": {
        "LIGHT": 1,
        "MODERATE": 1,
        "HEAVY": 1
      },
      "acclimatizingWorkers": 1
    },
    "pendingApprovals": 1,
    "activeActions": {
      "PENDING": 2,
      "ACKNOWLEDGED": 1,
      "COMPLETED": 0
    },
    "safetyEvents": [
      {
        "eventId": "event-456",
        "type": "CONCERN",
        "severity": "HIGH",
        "reportedBy": "worker-1",
        "reportedAt": "2026-07-29T14:20:00Z",
        "status": "OPEN"
      }
    ]
  }
  ```

- [ ] **Compliance Dashboard Endpoint**
  ```
  GET /api/v1/reports/compliance?startDate=2026-07-22&endDate=2026-07-29
  Authorization: Bearer <token> (Safety Manager)
  
  Response:
  {
    "acknowledgementRate": 0.95,
    "completionRate": 0.88,
    "medianAcknowledgementTimeSeconds": 45,
    "p90AcknowledgementTimeSeconds": 120,
    "lateOrUnacknowledgedActions": [
      {
        "actionId": "action-789",
        "workerId": "worker-2",
        "actionCode": "HYDRATE",
        "dispatchedAt": "2026-07-29T13:00:00Z",
        "status": "PENDING"
      }
    ],
    "recommendationMetrics": {
      "APPROVED": 5,
      "REJECTED": 1,
      "EDITED": 2
    },
    "actionsByWBGTBand": {
      "32_TO_BELOW_33": ["REST_10_MIN_HOURLY"],
      "33_AND_ABOVE": ["REST_15_MIN_HOURLY", "RESCHEDULE"]
    }
  }
  ```

- [ ] **ML Performance Dashboard Endpoint** (Sprint 3)
  ```
  GET /api/v1/reports/model-performance?startDate=2026-07-22&endDate=2026-07-29
  
  Response:
  {
    "modelVersion": "1.0",
    "trainingPeriod": "2025-02-01 to 2026-06-30",
    "metrics": {
      "mae": 1.23,
      "rmse": 1.67,
      "meanBias": 0.05,
      "macro_f1": 0.92
    },
    "riskBandMetrics": {
      "32_TO_BELOW_33": { "recall": 0.88, "precision": 0.85 },
      "33_AND_ABOVE": { "recall": 0.91, "precision": 0.89 }
    },
    "confusionMatrix": {...},
    "predictions": [
      {
        "timestamp": "2026-07-29T14:00:00Z",
        "observed": 31.8,
        "forecast30m": 32.1,
        "forecast60m": 32.7,
        "modelVersion": "1.0"
      }
    ]
  }
  ```

- [ ] **Audit Export Endpoint**
  ```
  GET /api/v1/audit/export?format=csv&startDate=2026-07-22&endDate=2026-07-29
  
  Returns CSV with:
  - timestamp, actor, eventType, targetType, targetId, details
  - Includes: recommendations, approvals, dispatches, acknowledgements
  - Sortable by date, filterable by shift/site
  ```

- [ ] **Multi-Site Real-Time View** (Stretch)
  ```
  GET /api/v1/safety-manager/all-sites-status
  
  Response: Array of sites with current risk, active directives, pending actions
  ```

---

### 1.8 Audit & Compliance

**Status:** Must Have (Sprint 1-2)  
**Complexity:** Medium  
**Effort:** 8-13 points

#### What to implement:

- [ ] **Audit Event Interceptor**
  - Use Spring AOP or JPA listeners to automatically create AuditEvent records
  - Capture: actor, eventType, target, timestamp, details
  - Events: USER_CREATED, SHIFT_CREATED, RECOMMENDATION_GENERATED, APPROVAL_GIVEN, ACTION_DISPATCHED, ACKNOWLEDGEMENT_RECEIVED

- [ ] **Immutable Audit Log**
  ```java
  @Entity
  public class AuditEvent {
    @Id
    private UUID id;
    
    @ManyToOne
    private User actor;
    
    private String eventType;
    private String targetType;
    private UUID targetId;
    
    @Lob
    private String details; // Full context as JSON
    
    private LocalDateTime occurredAt;
    
    // No update/delete methods - append-only
  }
  ```

- [ ] **Audit Repository with Constraints**
  ```java
  public interface AuditEventRepository extends JpaRepository<AuditEvent, UUID> {
    List<AuditEvent> findByTargetIdAndEventTypeOrderByOccurredAt(
      UUID targetId, String eventType);
    List<AuditEvent> findByActorIdAndOccurredAtBetween(
      UUID actorId, LocalDateTime start, LocalDateTime end);
  }
  ```

- [ ] **Data Retention Policy**
  ```java
  @Component
  public class DataRetentionService {
    @Scheduled(cron = "0 2 * * *") // Daily at 2 AM
    public void purgeEligibleOperationalData() {
      // Retain audit events: indefinitely
      // Retain weather/forecast: for model evaluation (3 months)
      // Retain readiness checks: 30 days after shift close
      // Retain safety events: per policy configuration
    }
  }
  ```

---

### 1.9 Error Handling & Degraded Mode

**Status:** Must Have (Sprint 2-3)  
**Complexity:** Medium  
**Effort:** 8-13 points

#### What to implement:

- [ ] **Global Exception Handler**
  ```java
  @RestControllerAdvice
  public class GlobalExceptionHandler {
    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleNotFound(...) {
      // 404 with correlation ID
    }
    
    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ErrorResponse> handleAccessDenied(...) {
      // 403 with audit log
    }
    
    @ExceptionHandler(ExternalServiceException.class)
    public ResponseEntity<ErrorResponse> handleExternalFailure(...) {
      // 503 with fallback guidance
    }
  }
  ```

- [ ] **Circuit Breaker for External Calls**
  ```java
  @Service
  public class NEAWeatherService {
    @CircuitBreaker(name = "nea-api", fallbackMethod = "getCachedForecast")
    public WBGTForecast getCurrentObservation(UUID siteId) {
      // Call NEA API
    }
    
    public WBGTForecast getCachedForecast(UUID siteId, Exception ex) {
      // Return last known observation with STALE marker
    }
  }
  ```

- [ ] **Resilience4j Configuration**
  ```yaml
  resilience4j:
    circuitbreaker:
      instances:
        nea-api:
          registerHealthIndicator: true
          failureRateThreshold: 50
          waitDurationInOpenState: 30000
        ml-service:
          failureRateThreshold: 50
          waitDurationInOpenState: 15000
  ```

---

### 1.10 API Documentation

**Status:** Should Have (Sprint 1-3)  
**Complexity:** Low  
**Effort:** 5-8 points

#### What to implement:

- [ ] **OpenAPI 3.0 / Swagger Documentation**
  ```xml
  <dependency>
    <groupId>org.springdoc</groupId>
    <artifactId>springdoc-openapi-starter-webmvc-ui</artifactId>
    <version>2.x</version>
  </dependency>
  ```

- [ ] **Endpoint Documentation**
  - Add `@Operation`, `@Parameter`, `@ApiResponse` annotations
  - Document request/response schemas
  - Include authentication requirements
  - Generate TypeScript client from OpenAPI

- [ ] **API Versioning Strategy**
  - Path-based: `/api/v1/...`
  - Keep v1 stable for MVP
  - Plan v2 for breaking changes post-launch

---

## Part 2: Features That NEED to be Done (Must-Have)

### Priority Matrix for Sprint Planning

| Feature | Sprint | Must | Complexity | Effort | Dependencies |
|---------|--------|------|-----------|--------|--------------|
| Cognito Auth & RBAC | 1 | Yes | Medium | 10-13 | None |
| Core Data Models | 1 | Yes | Medium | 15-21 | Auth |
| Weather Ingestion | 1-2 | Yes | Medium | 13-21 | Data Models |
| Policy Engine | 2 | Yes | High | 13-21 | Data Models |
| Recommendations & Approval | 2 | Yes | High | 21-34 | Policy Engine |
| Action Dispatch & Acknowledgement | 2 | Yes | Medium | 13-21 | Recommendations |
| Dashboards & Reports | 3 | Yes | Medium-High | 13-21 | All above |
| Audit & Compliance | 1-2 | Yes | Medium | 8-13 | Data Models |
| Error Handling & Resilience | 2-3 | Yes | Medium | 8-13 | All services |
| API Documentation | 1-3 | Should | Low | 5-8 | All endpoints |

---

## Part 3: Architecture Decisions for Amazon Cognito

### 3.1 Cognito Setup

```yaml
User Pool Configuration:
- Name: crewsafe-user-pool
- Attributes:
  - email (required, unique)
  - name
  - phone_number
  - custom:site_id (for site scoping)
- MFA: Optional (SMS or TOTP)
- Password Policy: Minimum 12 characters, upper, lower, number, special
- User Groups:
  - workers
  - supervisors
  - safety-managers
  - administrators
```

### 3.2 Cognito to Spring Security Mapping

```
Cognito User Groups → Spring Security ROLES

Cognito Group: workers → Authority: ROLE_WORKER
Cognito Group: supervisors → Authority: ROLE_SUPERVISOR
Cognito Group: safety-managers → Authority: ROLE_SAFETY_MANAGER
Cognito Group: administrators → Authority: ROLE_ADMINISTRATOR
```

### 3.3 Token Structure

**Access Token (JWT)**:
```json
{
  "sub": "12345-67890-abcdef",
  "email": "worker@example.com",
  "cognito:groups": ["workers"],
  "iat": 1690000000,
  "exp": 1690003600
}
```

**ID Token (JWT)**:
```json
{
  "sub": "12345-67890-abcdef",
  "email": "worker@example.com",
  "name": "John Worker",
  "aud": "app-client-id",
  "iat": 1690000000,
  "exp": 1690003600
}
```

### 3.4 Spring Security Configuration

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
  
  @Bean
  public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http
      .authorizeHttpRequests(auth -> auth
        .requestMatchers("/api/v1/auth/login").permitAll()
        .requestMatchers("/api/v1/health").permitAll()
        .requestMatchers("/api/v1/sites/**").hasAnyRole("WORKER", "SUPERVISOR", "SAFETY_MANAGER")
        .requestMatchers("/api/v1/recommendations/**/decision").hasRole("SUPERVISOR")
        .requestMatchers("/api/v1/reports/**").hasRole("SAFETY_MANAGER")
        .anyRequest().authenticated()
      )
      .oauth2ResourceServer(oauth2 -> oauth2
        .jwt(jwt -> jwt
          .jwtAuthenticationConverter(jwtAuthenticationConverter())
        )
      );
    return http.build();
  }
  
  @Bean
  public JwtAuthenticationConverter jwtAuthenticationConverter() {
    JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
    converter.setJwtGrantedAuthoritiesConverter(jwt -> {
      // Extract groups from token and convert to ROLE_*
      List<String> groups = jwt.getClaimAsStringList("cognito:groups");
      return groups.stream()
        .map(g -> "ROLE_" + g.toUpperCase())
        .map(SimpleGrantedAuthority::new)
        .collect(Collectors.toList());
    });
    return converter;
  }
}
```

---

## Part 4: Development Roadmap by Sprint

### **Sprint 1 (Week 2): Foundation & Prototype**

**Goals:**
- Set up Cognito and authenticate via Spring Security
- Implement core data models (User, Site, Shift, Assignment, ReadinessCheck)
- Ingest weather data and display freshness
- Establish CI/CD pipeline

**Tasks:**
1. [ ] Create Cognito User Pool with groups
2. [ ] Configure Spring Boot OAuth 2.0 Resource Server
3. [ ] Implement authentication endpoints
4. [ ] Create JPA entities and repositories
5. [ ] Add database migrations (Flyway)
6. [ ] Implement shift creation and worker assignment
7. [ ] Implement worker readiness check submission
8. [ ] Integrate with NEA WBGT API (mock initially)
9. [ ] Create weather observation storage
10. [ ] Implement `/sites/{siteId}/conditions` endpoint with freshness
11. [ ] Set up GitHub Actions CI pipeline (build, test, SAST, secret scan)
12. [ ] Deploy to AWS Fargate + RDS
13. [ ] Document API with OpenAPI/Swagger

**Output:**
- Running backend on Fargate with Cognito auth
- Web/mobile clients can login and see site conditions
- Unit tests for auth and data models
- CI pipeline automated

---

### **Sprint 2 (Week 3): Core Business Logic**

**Goals:**
- Implement ML forecasting integration
- Build deterministic policy engine
- Create recommendation workflow with approval
- Implement action dispatch and acknowledgement

**Tasks:**
1. [ ] Integrate ML service for WBGT forecasting
2. [ ] Implement fallback persistence forecast
3. [ ] Build policy evaluation service with rule matrix
4. [ ] Create recommendation generation endpoint
5. [ ] Implement approval/edit/reject workflow
6. [ ] Preserve both agent draft and supervisor edits
7. [ ] Implement action dispatch (worker notification)
8. [ ] Implement acknowledgement endpoint with idempotency
9. [ ] Implement completion types (rest, hydration)
10. [ ] Implement Server-Sent Events for supervisor live updates
11. [ ] Add safety event creation endpoint
12. [ ] Implement timeout escalation for undecided stop-work
13. [ ] Add audit event creation (AOP-based)
14. [ ] Implement lightning risk ingestion and assessment
15. [ ] Create integration tests for end-to-end flows
16. [ ] Deploy staging environment with smoke tests

**Output:**
- Full approval workflow functional
- Workers receive and acknowledge actions
- Audit trail complete
- Integration tests passing
- Staging deployment automated

---

### **Sprint 3 (Week 4): Dashboards, Quality, Security**

**Goals:**
- Complete all dashboards (compliance, ML, multi-site)
- Achieve security remediation
- Run full UAT
- Prepare for demo

**Tasks:**
1. [ ] Implement live site dashboard endpoint
2. [ ] Implement compliance dashboard with metrics
3. [ ] Implement ML performance dashboard
4. [ ] Implement audit export (CSV/PDF)
5. [ ] Add multi-site safety manager view
6. [ ] Implement scoped, auto-expiring supervisor override (stretch)
7. [ ] Add heat-illness incident reporting
8. [ ] Implement data retention and consent tracking
9. [ ] Add shift close-out with reconciliation
10. [ ] Implement offline instruction caching (mobile-specific)
11. [ ] Add language-neutral pictogram support
12. [ ] Run full security testing suite
13. [ ] Perform DAST, dependency, container scans
14. [ ] Remediate or document all findings
15. [ ] Run performance tests (p95 latency targets)
16. [ ] Run WCAG accessibility checks
17. [ ] Execute full UAT with test scenarios
18. [ ] Prepare demonstration and recording

**Output:**
- All dashboards operational
- Security audit clean
- UAT passed
- Demo ready
- Performance targets met

---

## Part 5: Critical API Endpoints Summary

### Authentication
```
POST /api/v1/auth/login
GET  /api/v1/me
POST /api/v1/auth/refresh
```

### Sites & Conditions
```
GET /api/v1/sites/{siteId}/conditions
GET /api/v1/sites/{siteId}/dashboard
GET /api/v1/sites/{siteId}/live-updates (SSE)
```

### Shifts & Assignments
```
POST /api/v1/shifts
PUT  /api/v1/shifts/{shiftId}
POST /api/v1/shifts/{shiftId}/assignments
GET  /api/v1/shifts/{shiftId}
```

### Readiness Checks
```
POST /api/v1/assignments/{id}/readiness-check
GET  /api/v1/shifts/{shiftId}/readiness-summary
```

### Recommendations
```
POST /api/v1/shifts/{shiftId}/recommendations/generate
GET  /api/v1/recommendations/{id}
POST /api/v1/recommendations/{id}/decision
```

### Worker Actions
```
GET  /api/v1/me/actions
POST /api/v1/actions/{id}/acknowledge
POST /api/v1/actions/{id}/complete
```

### Safety Events
```
POST /api/v1/shifts/{shiftId}/safety-events
GET  /api/v1/sites/{siteId}/safety-events
```

### Dashboards & Reporting
```
GET /api/v1/reports/compliance
GET /api/v1/reports/model-performance
GET /api/v1/audit/export
GET /api/v1/safety-manager/all-sites-status (stretch)
```

### Policy Management
```
GET /api/v1/policies
PUT /api/v1/policies/{versionId}
GET /api/v1/policies/{versionId}/rules
```

---

## Part 6: Technology Stack Confirmed

| Layer | Technology | Version |
|-------|-----------|---------|
| Language | Java | 21 LTS |
| Framework | Spring Boot | 3.x |
| Security | Spring Security + OAuth 2.0 | 6.x |
| Database | PostgreSQL | 14+ |
| ORM | Spring Data JPA + Hibernate | Latest |
| Authentication | Amazon Cognito | (AWS service) |
| API Docs | SpringDoc OpenAPI | 2.x |
| Resilience | Resilience4j | Latest |
| Testing | JUnit 5, Mockito, RestAssured | Latest |
| Build | Maven | 3.9+ |
| CI/CD | GitHub Actions | - |
| Containerization | Docker | Latest |
| Deployment | AWS ECS Fargate + RDS | - |

---

## Part 7: Key Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Cognito configuration delays | High | Pre-create pool, use terraform |
| ML service unavailable at launch | Medium | Implement persistence fallback early |
| Database migration issues | High | Use Flyway/Liquibase, test on staging |
| Policy rule misinterpretation | High | Version rules, get advisor review |
| Token validation failures | High | Validate JWT schema early, test with real tokens |
| Audit trail performance at scale | Medium | Add indexes, archive old records per retention policy |

---

## Recommendation: Immediate Next Steps

1. **Week 1 (Sprint 0):**
   - Create Cognito User Pool in AWS
   - Clone this repository and set up local Spring Boot project structure
   - Create `pom.xml` with dependencies (Spring Boot, Security, JPA, etc.)
   - Define initial entity classes and JPA repositories

2. **Week 2 (Sprint 1):**
   - Implement Cognito authentication in Spring Security
   - Create database schema (migrations)
   - Implement shift and assignment management
   - Integrate weather ingestion (mock first)

3. **Week 3 (Sprint 2):**
   - Implement policy engine
   - Build recommendation workflow
   - Add action dispatch and acknowledgement

4. **Week 4 (Sprint 3):**
   - Complete dashboards
   - Security testing and remediation
   - UAT and final demo preparation

---

**Document Status:** Ready for Development  
**Next Review:** After Sprint 1 Planning  
**Owner:** Backend Lead / Engineering Team
