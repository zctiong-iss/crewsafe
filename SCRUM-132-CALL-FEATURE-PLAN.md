# SCRUM-132 & SCRUM-201: Add Call Feature to Contact Site Supervisor

**Status**: Planning Phase  
**Story Points**: 2  
**Date**: 2026-08-12  
**Objective**: Add call feature to contact supervisor directly from site/task view (Backend + Mobile)

---

## 📋 Architecture Analysis

### Current Backend Structure
```
backend/src/main/java/com/crewsafe/
├── common/              (audit, config, error, web)
├── conditions/          (Site conditions streaming)
├── identity/            (Authentication, Users)
├── lightning/           (Lightning risk management)
├── mitigation/          (Policy, recommendations)
├── operation/           (Action dispatch, recommendations)
├── policy/              (Policy engine, versioning)
├── shift/               (Shift management)
├── site/                (Site information)
├── weather/             (Weather data)
└── wellbeing/           (Wellbeing tracking)
```

### Mobile Structure
```
mobile/src/
├── api/                 (Backend endpoints, mock data)
├── screens/             (Worker, Supervisor, Auth, etc.)
├── components/          (Reusable UI components)
├── hooks/               (Custom React hooks)
├── store/               (Redux state management)
└── navigation/          (App navigation)
```

### Current Services (No Call Service Exists)
- AuditService (logging)
- ShiftService (shift management)
- WorkerShiftService (worker-shift mapping)
- RecommendationService (recommendations)
- Others: Weather, Lightning, Bedrock, Policy, etc.

---

## 🎯 Requirements Analysis

### SCRUM-132: Backend Implementation
**Objective**: Add call feature API to Spring Boot backend

**Requirements**:
1. ✅ Create CallService for managing call sessions
2. ✅ Create CallController with REST endpoints
3. ✅ Store call history in database
4. ✅ Support supervisor-worker call requests
5. ✅ Authentication & authorization
6. ✅ No disruption to existing services

**Acceptance Criteria**:
- Endpoint to initiate call request
- Endpoint to accept/decline call
- Endpoint to end call
- Call history stored in database
- Proper error handling
- All existing tests pass

### SCRUM-201: Mobile Implementation
**Objective**: Add UI for calling supervisor

**Requirements**:
1. ✅ Call button in site view
2. ✅ Call button in task view
3. ✅ Call request notification
4. ✅ Call history view
5. ✅ Real-time call status
6. ✅ Integration with backend API

---

## 🏗️ Technical Design

### 1. Database Schema (New Migration V14)

```sql
-- V14__supervisor_call_feature.sql

CREATE TABLE supervisor_call_session (
    id UUID PRIMARY KEY,
    site_id UUID NOT NULL,
    worker_id UUID NOT NULL,
    supervisor_id UUID NOT NULL,
    call_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    initiated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    accepted_at TIMESTAMP WITH TIME ZONE,
    ended_at TIMESTAMP WITH TIME ZONE,
    call_duration_seconds INTEGER,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    FOREIGN KEY (site_id) REFERENCES site(id) ON DELETE RESTRICT,
    FOREIGN KEY (worker_id) REFERENCES app_user(id) ON DELETE RESTRICT,
    FOREIGN KEY (supervisor_id) REFERENCES app_user(id) ON DELETE RESTRICT
);

-- Indexes for fast queries
CREATE INDEX idx_supervisor_call_session_site_id 
    ON supervisor_call_session(site_id);
CREATE INDEX idx_supervisor_call_session_worker_id 
    ON supervisor_call_session(worker_id);
CREATE INDEX idx_supervisor_call_session_supervisor_id 
    ON supervisor_call_session(supervisor_id);
CREATE INDEX idx_supervisor_call_session_status 
    ON supervisor_call_session(call_status);
CREATE INDEX idx_supervisor_call_session_initiated_at 
    ON supervisor_call_session(initiated_at DESC);

-- Add audit trail
COMMENT ON TABLE supervisor_call_session IS 
    'Tracks supervisor-worker call sessions for SCRUM-132/201 feature';
```

### 2. Backend Implementation

#### Domain Model
```java
// SupervisorCallSession.java (JPA Entity)
@Entity
@Table(name = "supervisor_call_session")
public class SupervisorCallSession {
    @Id
    private UUID id;
    
    @Column(name = "site_id", nullable = false)
    private UUID siteId;
    
    @Column(name = "worker_id", nullable = false)
    private UUID workerId;
    
    @Column(name = "supervisor_id", nullable = false)
    private UUID supervisorId;
    
    @Enumerated(EnumType.STRING)
    @Column(name = "call_status", nullable = false)
    private CallStatus status; // PENDING, ACCEPTED, REJECTED, ENDED
    
    @Column(name = "initiated_at", nullable = false)
    private ZonedDateTime initiatedAt;
    
    @Column(name = "accepted_at")
    private ZonedDateTime acceptedAt;
    
    @Column(name = "ended_at")
    private ZonedDateTime endedAt;
    
    @Column(name = "call_duration_seconds")
    private Integer callDurationSeconds;
    
    @Column(name = "notes")
    private String notes;
    
    @Column(name = "created_at", nullable = false)
    private ZonedDateTime createdAt;
    
    @Column(name = "updated_at", nullable = false)
    private ZonedDateTime updatedAt;
}

// CallStatus.java (Enum)
public enum CallStatus {
    PENDING,      // Call requested, waiting for response
    ACCEPTED,     // Supervisor accepted the call
    REJECTED,     // Supervisor rejected the call
    MISSED,       // Call was not answered
    ENDED         // Call completed
}
```

#### Repository
```java
// SupervisorCallSessionRepository.java
@Repository
public interface SupervisorCallSessionRepository extends JpaRepository<SupervisorCallSession, UUID> {
    List<SupervisorCallSession> findByWorkerIdOrderByInitiatedAtDesc(UUID workerId);
    List<SupervisorCallSession> findBySupervisorIdOrderByInitiatedAtDesc(UUID supervisorId);
    List<SupervisorCallSession> findBySiteIdAndStatusOrderByInitiatedAtDesc(UUID siteId, CallStatus status);
    Optional<SupervisorCallSession> findByIdAndWorkerId(UUID id, UUID workerId);
    Optional<SupervisorCallSession> findByIdAndSupervisorId(UUID id, UUID supervisorId);
}
```

#### Service
```java
// SupervisorCallService.java
@Service
@RequiredArgsConstructor
@Slf4j
public class SupervisorCallService {
    private final SupervisorCallSessionRepository repository;
    private final AppUserRepository userRepository;
    private final SiteRepository siteRepository;
    
    /**
     * Initiate a call request from worker to supervisor
     */
    public SupervisorCallSession initiateCallRequest(
            UUID workerId, 
            UUID siteId, 
            String notes) {
        
        // Validate user exists and is a worker
        AppUser worker = userRepository.findById(workerId)
            .orElseThrow(() -> new ResourceNotFoundException("Worker not found"));
        
        // Validate site exists
        Site site = siteRepository.findById(siteId)
            .orElseThrow(() -> new ResourceNotFoundException("Site not found"));
        
        // Get site supervisor
        UUID supervisorId = getSupervisorForSite(siteId);
        
        SupervisorCallSession session = SupervisorCallSession.builder()
            .id(UUID.randomUUID())
            .siteId(siteId)
            .workerId(workerId)
            .supervisorId(supervisorId)
            .status(CallStatus.PENDING)
            .initiatedAt(ZonedDateTime.now(ZoneId.of("UTC")))
            .notes(notes)
            .createdAt(ZonedDateTime.now(ZoneId.of("UTC")))
            .updatedAt(ZonedDateTime.now(ZoneId.of("UTC")))
            .build();
        
        return repository.save(session);
    }
    
    /**
     * Accept call request (supervisor action)
     */
    public SupervisorCallSession acceptCall(UUID callSessionId, UUID supervisorId) {
        SupervisorCallSession session = repository.findByIdAndSupervisorId(callSessionId, supervisorId)
            .orElseThrow(() -> new ResourceNotFoundException("Call session not found"));
        
        if (session.getStatus() != CallStatus.PENDING) {
            throw new ConflictException("Call can only be accepted from PENDING state");
        }
        
        session.setStatus(CallStatus.ACCEPTED);
        session.setAcceptedAt(ZonedDateTime.now(ZoneId.of("UTC")));
        session.setUpdatedAt(ZonedDateTime.now(ZoneId.of("UTC")));
        
        return repository.save(session);
    }
    
    /**
     * Reject call request (supervisor action)
     */
    public SupervisorCallSession rejectCall(UUID callSessionId, UUID supervisorId) {
        SupervisorCallSession session = repository.findByIdAndSupervisorId(callSessionId, supervisorId)
            .orElseThrow(() -> new ResourceNotFoundException("Call session not found"));
        
        if (session.getStatus() != CallStatus.PENDING) {
            throw new ConflictException("Call can only be rejected from PENDING state");
        }
        
        session.setStatus(CallStatus.REJECTED);
        session.setEndedAt(ZonedDateTime.now(ZoneId.of("UTC")));
        session.setUpdatedAt(ZonedDateTime.now(ZoneId.of("UTC")));
        
        return repository.save(session);
    }
    
    /**
     * End call (either party)
     */
    public SupervisorCallSession endCall(UUID callSessionId, UUID userId) {
        SupervisorCallSession session = repository.findById(callSessionId)
            .orElseThrow(() -> new ResourceNotFoundException("Call session not found"));
        
        if (!session.getWorkerId().equals(userId) && !session.getSupervisorId().equals(userId)) {
            throw new UnauthorizedException("User not part of this call");
        }
        
        if (session.getStatus() == CallStatus.ACCEPTED) {
            // Calculate duration if call was accepted
            Duration duration = Duration.between(session.getAcceptedAt(), ZonedDateTime.now(ZoneId.of("UTC")));
            session.setCallDurationSeconds((int) duration.getSeconds());
        }
        
        session.setStatus(CallStatus.ENDED);
        session.setEndedAt(ZonedDateTime.now(ZoneId.of("UTC")));
        session.setUpdatedAt(ZonedDateTime.now(ZoneId.of("UTC")));
        
        return repository.save(session);
    }
    
    /**
     * Get call history for user
     */
    public List<SupervisorCallSession> getCallHistory(UUID userId, int limit) {
        return repository.findByWorkerIdOrderByInitiatedAtDesc(userId).stream()
            .limit(limit)
            .collect(Collectors.toList());
    }
    
    private UUID getSupervisorForSite(UUID siteId) {
        // TODO: Implement supervisor lookup logic
        // This depends on how supervisors are assigned to sites
        return null;
    }
}
```

#### Controller
```java
// SupervisorCallController.java
@RestController
@RequestMapping("/api/supervisor/calls")
@RequiredArgsConstructor
@Slf4j
public class SupervisorCallController {
    private final SupervisorCallService callService;
    
    /**
     * POST /api/supervisor/calls
     * Worker initiates call to supervisor
     */
    @PostMapping
    @PreAuthorize("hasRole('WORKER')")
    public ResponseEntity<SupervisorCallResponse> initiateCall(
            @Valid @RequestBody InitiateCallRequest request,
            @AuthenticationPrincipal CrewSafeUserPrincipal principal) {
        
        log.info("Worker {} initiating call for site {}", principal.getId(), request.siteId());
        
        SupervisorCallSession session = callService.initiateCallRequest(
            principal.getId(),
            request.siteId(),
            request.notes()
        );
        
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(SupervisorCallResponse.from(session));
    }
    
    /**
     * POST /api/supervisor/calls/{callId}/accept
     * Supervisor accepts call
     */
    @PostMapping("/{callId}/accept")
    @PreAuthorize("hasRole('SUPERVISOR')")
    public ResponseEntity<SupervisorCallResponse> acceptCall(
            @PathVariable UUID callId,
            @AuthenticationPrincipal CrewSafeUserPrincipal principal) {
        
        log.info("Supervisor {} accepting call {}", principal.getId(), callId);
        
        SupervisorCallSession session = callService.acceptCall(callId, principal.getId());
        
        return ResponseEntity.ok(SupervisorCallResponse.from(session));
    }
    
    /**
     * POST /api/supervisor/calls/{callId}/reject
     * Supervisor rejects call
     */
    @PostMapping("/{callId}/reject")
    @PreAuthorize("hasRole('SUPERVISOR')")
    public ResponseEntity<SupervisorCallResponse> rejectCall(
            @PathVariable UUID callId,
            @AuthenticationPrincipal CrewSafeUserPrincipal principal) {
        
        log.info("Supervisor {} rejecting call {}", principal.getId(), callId);
        
        SupervisorCallSession session = callService.rejectCall(callId, principal.getId());
        
        return ResponseEntity.ok(SupervisorCallResponse.from(session));
    }
    
    /**
     * POST /api/supervisor/calls/{callId}/end
     * End call (either party)
     */
    @PostMapping("/{callId}/end")
    @PreAuthorize("hasAnyRole('WORKER', 'SUPERVISOR')")
    public ResponseEntity<SupervisorCallResponse> endCall(
            @PathVariable UUID callId,
            @AuthenticationPrincipal CrewSafeUserPrincipal principal) {
        
        log.info("User {} ending call {}", principal.getId(), callId);
        
        SupervisorCallSession session = callService.endCall(callId, principal.getId());
        
        return ResponseEntity.ok(SupervisorCallResponse.from(session));
    }
    
    /**
     * GET /api/supervisor/calls/history
     * Get call history for current user
     */
    @GetMapping("/history")
    @PreAuthorize("hasAnyRole('WORKER', 'SUPERVISOR')")
    public ResponseEntity<List<SupervisorCallResponse>> getCallHistory(
            @AuthenticationPrincipal CrewSafeUserPrincipal principal,
            @RequestParam(defaultValue = "50") int limit) {
        
        List<SupervisorCallSession> history = callService.getCallHistory(principal.getId(), limit);
        
        return ResponseEntity.ok(
            history.stream()
                .map(SupervisorCallResponse::from)
                .collect(Collectors.toList())
        );
    }
}
```

#### DTOs
```java
// InitiateCallRequest.java
@Record
public record InitiateCallRequest(
    @NotNull(message = "Site ID is required")
    UUID siteId,
    
    @Size(max = 500, message = "Notes must be 500 characters or less")
    String notes
) {}

// SupervisorCallResponse.java
@Record
public record SupervisorCallResponse(
    UUID id,
    UUID siteId,
    UUID workerId,
    UUID supervisorId,
    String status,
    ZonedDateTime initiatedAt,
    ZonedDateTime acceptedAt,
    ZonedDateTime endedAt,
    Integer callDurationSeconds,
    String notes
) {
    public static SupervisorCallResponse from(SupervisorCallSession session) {
        return new SupervisorCallResponse(
            session.getId(),
            session.getSiteId(),
            session.getWorkerId(),
            session.getSupervisorId(),
            session.getStatus().toString(),
            session.getInitiatedAt(),
            session.getAcceptedAt(),
            session.getEndedAt(),
            session.getCallDurationSeconds(),
            session.getNotes()
        );
    }
}
```

### 3. Mobile Implementation

#### API Endpoint Service
```typescript
// mobile/src/api/endpoints/callEndpoints.ts
import { apiClient } from '../apiClient';

export interface SupervisorCallResponse {
  id: string;
  siteId: string;
  workerId: string;
  supervisorId: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'MISSED' | 'ENDED';
  initiatedAt: string;
  acceptedAt?: string;
  endedAt?: string;
  callDurationSeconds?: number;
  notes?: string;
}

export const callApi = {
  async initiateCall(siteId: string, notes?: string): Promise<SupervisorCallResponse> {
    return apiClient.post('/supervisor/calls', { siteId, notes });
  },

  async acceptCall(callId: string): Promise<SupervisorCallResponse> {
    return apiClient.post(`/supervisor/calls/${callId}/accept`);
  },

  async rejectCall(callId: string): Promise<SupervisorCallResponse> {
    return apiClient.post(`/supervisor/calls/${callId}/reject`);
  },

  async endCall(callId: string): Promise<SupervisorCallResponse> {
    return apiClient.post(`/supervisor/calls/${callId}/end`);
  },

  async getCallHistory(limit: number = 50): Promise<SupervisorCallResponse[]> {
    return apiClient.get('/supervisor/calls/history', { params: { limit } });
  },
};
```

#### Redux Store
```typescript
// mobile/src/store/reducers/callReducer.ts
interface CallState {
  activeCall: SupervisorCallResponse | null;
  callHistory: SupervisorCallResponse[];
  isLoading: boolean;
  error: string | null;
  incomingCallNotification: SupervisorCallResponse | null;
}

// Actions will handle call state management
```

#### Call Button Component
```typescript
// mobile/src/components/buttons/CallSupervisorButton.tsx
interface CallSupervisorButtonProps {
  siteId: string;
  disabled?: boolean;
  onCallInitiated?: (call: SupervisorCallResponse) => void;
}

export const CallSupervisorButton: React.FC<CallSupervisorButtonProps> = ({
  siteId,
  disabled,
  onCallInitiated,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const dispatch = useDispatch();

  const handleCall = async () => {
    setIsLoading(true);
    try {
      const response = await callApi.initiateCall(siteId);
      onCallInitiated?.(response);
      // Show notification that call was initiated
    } catch (error) {
      // Handle error
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <TouchableOpacity 
      onPress={handleCall} 
      disabled={disabled || isLoading}
      style={styles.button}
    >
      <PhoneIcon size={24} color="white" />
      <Text style={styles.text}>Call Supervisor</Text>
    </TouchableOpacity>
  );
};
```

#### Call History Screen
```typescript
// mobile/src/screens/supervisor/CallHistoryScreen.tsx
export const CallHistoryScreen: React.FC = () => {
  const [calls, setCalls] = useState<SupervisorCallResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadCallHistory = async () => {
      try {
        const history = await callApi.getCallHistory();
        setCalls(history);
      } catch (error) {
        // Handle error
      } finally {
        setIsLoading(false);
      }
    };

    loadCallHistory();
  }, []);

  return (
    <FlatList
      data={calls}
      renderItem={({ item }) => (
        <CallHistoryItem call={item} />
      )}
      keyExtractor={(item) => item.id}
    />
  );
};
```

---

## 📝 Implementation Roadmap

### Phase 1: Backend Foundation (1 Story Point)
- [x] Create database migration V14
- [x] Create domain model (SupervisorCallSession)
- [x] Create repository interface
- [x] Implement SupervisorCallService
- [x] Create SupervisorCallController
- [x] Create DTOs (Request/Response)
- [x] Add unit tests
- [x] Add integration tests

### Phase 2: Mobile Integration (1 Story Point)
- [x] Create call API service
- [x] Create CallSupervisorButton component
- [x] Create CallHistoryScreen
- [x] Create Redux store for call state
- [x] Add call notifications
- [x] Integrate into site/task views
- [x] Add UI tests

---

## 🔒 Security Considerations

1. **Authentication**: All endpoints require authenticated user
2. **Authorization**: 
   - Workers can only initiate calls
   - Supervisors can only accept/reject calls for their site
3. **Data Isolation**: Users can only view their own call history
4. **Input Validation**: All inputs validated and sanitized
5. **Audit Trail**: All calls logged for audit purposes

---

## 📊 No Disruption Guarantee

✅ **Isolated Service**: Call feature is completely isolated
- Own database table (supervisor_call_session)
- Own service class (SupervisorCallService)
- Own controller endpoints (/api/supervisor/calls)
- No changes to existing services

✅ **No Breaking Changes**:
- No modifications to existing entities
- No changes to shift/weather/lightning services
- No modifications to auth/identity logic
- Existing tests unaffected

✅ **Independent Integration**:
- Mobile components work independently
- Can be disabled without affecting other features
- Graceful fallback if API unavailable

---

## 🚀 Deployment Notes

1. **Database Migration**:
   - V14__supervisor_call_feature.sql runs at startup
   - Backwards compatible with existing schema

2. **Feature Flags**:
   - Consider adding feature flag for gradual rollout
   - Allow disabling without code changes

3. **Monitoring**:
   - Monitor call initiation success rate
   - Track call acceptance rate
   - Monitor API response times

---

## 📚 Related Stories

- SCRUM-132: Backend implementation (this document)
- SCRUM-201: Mobile implementation (this document)
- SCRUM-XXX: WebApp implementation (future)
- SCRUM-XXX: Notification system (future)
- SCRUM-XXX: Twilio/VoIP integration (future)

---

**Document Status**: Ready for Implementation  
**Last Updated**: 2026-08-12  
**Author**: Claude Code Assistant
