# 🚀 Sprint 2 Development Plan (Aug 7-13, 2026)
**Total Hours: 28 (7 hours/day × 4 days)**  
**Assignee:** Surya Kumaraguru  
**Sprint:** SCRUM Sprint 2 (Aug 7-13)

---

## 📋 SCRUM Items (7 Total)

| Priority | Issue | Title | Est. Hours | Type | Status |
|----------|-------|-------|-----------|------|--------|
| 🔴 High | SCRUM-117 | US-07 Deterministic policy actions | 8 | Story | To Do |
| 🔴 High | SCRUM-118 | US-08 Supervisor receives agent draft | 8 | Story | To Do |
| 🟡 Medium | SCRUM-122 | US-36 Trace agent runs in observability | 5 | Story | To Do |
| 🔴 High | SCRUM-125 | US-11 Worker logs rest/hydration | 8 | Story | To Do |
| 🔴 High | SCRUM-133 | US-12 Supervisor monitors actions | 8 | Story | To Do |
| 🔴 High | SCRUM-137 | US-40 Escalate unapproved stop-work | 8 | Story | To Do |
| 🔵 Low | SCRUM-201 | Add Call feature | 3 | Story | To Do |
| | | **TOTAL** | **48 pts** | | |

---

## 📅 DAY-BY-DAY BREAKDOWN

### **Day 1: Friday, August 7 (7 hours)**
**Focus: Foundation & High-Priority Policy Engine**

#### Morning (9:00-12:30 | 3.5 hrs)
- **Setup & Environment** (30 min)
  - [ ] Verify backend builds locally: `mvn clean package`
  - [ ] Check SonarCube properties configured
  - [ ] Review `sonar-project.properties`
  - [ ] Verify test environment ready

- **SCRUM-117: Deterministic Policy Actions** (3 hrs)
  - [ ] Create branch: `git checkout -b feat/scrum-117-policy-engine`
  - [ ] Analyze policy requirements (existing rules engine)
  - [ ] Create `PolicyEvaluationService.java`
  - [ ] Implement deterministic policy logic
  - [ ] Write unit tests for boundary conditions
  - **Code Focus:**
    - Rule engine integration (Java 21)
    - PostgreSQL policy config queries
    - Deterministic outcomes validation
    - Input validation & error handling

#### Afternoon (13:30-17:00 | 3.5 hrs)
- **SCRUM-117 Continued** (2 hrs)
  - [ ] Complete policy logic tests
  - [ ] Test mixed-worker scenarios
  - [ ] Verify no breaking changes to shift domain
  
- **SCRUM-118 Initial** (1.5 hrs)
  - [ ] Create branch: `git checkout -b feat/scrum-118-agent-draft`
  - [ ] Analyze agent draft plan requirements
  - [ ] Setup supervisor response payload structure
  - [ ] Review Bedrock connectivity (SCRUM-187 foundation)

**Deliverables:**
- ✅ Policy engine core logic complete
- ✅ Unit tests passing locally
- ✅ No compilation errors

---

### **Day 2: Tuesday, August 11 (7 hours)**
**Focus: Agent Integration & Supervisor Features**

#### Morning (9:00-12:30 | 3.5 hrs)
- **SCRUM-118: Supervisor Receives Agent Draft** (3.5 hrs)
  - [ ] Implement `AgentDraftPlanController.java`
  - [ ] Create response DTO: `AgentDraftPlanResponse.java`
  - [ ] Integrate with Bedrock (via SCRUM-187 foundation)
  - [ ] Add structured output validation
  - [ ] Implement authorization checks (supervisor role)
  - **Code Focus:**
    - REST endpoint `/api/supervisor/agent-plans`
    - Pydantic schema validation
    - Timeout handling (30s max)
    - Audit logging (SCRUM-183)

#### Afternoon (13:30-17:00 | 3.5 hrs)
- **SCRUM-118 Continued & Testing** (2 hrs)
  - [ ] Unit tests for agent response parsing
  - [ ] Integration tests with Bedrock mock
  - [ ] Error handling tests (timeout, invalid schema)

- **SCRUM-122 Initial** (1.5 hrs)
  - [ ] Create branch: `git checkout -b feat/scrum-122-agent-observability`
  - [ ] Design `AgentRunTrace` entity
  - [ ] Plan observability schema

**Deliverables:**
- ✅ Agent draft endpoint implemented
- ✅ Tests covering happy path + error scenarios
- ✅ Observability schema designed

---

### **Day 3: Wednesday, August 12 (7 hours)**
**Focus: Worker & Supervisor Monitoring Features**

#### Morning (9:00-12:30 | 3.5 hrs)
- **SCRUM-125: Worker Logs Rest/Hydration** (2 hrs)
  - [ ] Create branch: `git checkout -b feat/scrum-125-worker-rest-logging`
  - [ ] Implement `WorkerRestLogController.java`
  - [ ] Create `WorkerConcernService.java`
  - [ ] Database schema for rest/concern logs
  - [ ] Add audit events (SCRUM-183)

- **SCRUM-133: Supervisor Monitors Actions** (1.5 hrs)
  - [ ] Create branch: `git checkout -b feat/scrum-133-action-monitoring`
  - [ ] Implement `ActionMonitoringController.java`
  - [ ] Create queries for pending/late/completed actions
  - [ ] Status aggregation logic

#### Afternoon (13:30-17:00 | 3.5 hrs)
- **SCRUM-125 & SCRUM-133 Testing** (2 hrs)
  - [ ] Test rest logging endpoint
  - [ ] Test monitoring dashboard queries
  - [ ] Integration tests with action dispatch (SCRUM-185)

- **SCRUM-122 Continued** (1.5 hrs)
  - [ ] Implement `AgentRunTraceService.java`
  - [ ] Create observability endpoints
  - [ ] Integration with monitoring tools

**Deliverables:**
- ✅ Worker rest logging feature complete
- ✅ Supervisor monitoring queries working
- ✅ Agent run tracing implemented

---

### **Day 4: Thursday, August 13 (7 hours)**
**Focus: Escalation, Call Feature & Testing/Security Review**

#### Morning (9:00-12:30 | 3.5 hrs)
- **SCRUM-137: Escalate Stop-Work Recommendations** (2 hrs)
  - [ ] Create branch: `git checkout -b feat/scrum-137-escalation`
  - [ ] Implement `EscalationService.java`
  - [ ] Timeout handling logic
  - [ ] Human approval workflow integration
  - [ ] Audit event emission (SCRUM-183)

- **SCRUM-201: Add Call Feature** (1.5 hrs)
  - [ ] Create branch: `git checkout -b feat/scrum-201-call-feature`
  - [ ] Implement `ContactSupervisorController.java`
  - [ ] Call routing/connection logic
  - [ ] Basic error handling

#### Afternoon (13:30-17:00 | 3.5 hrs)
- **Security & Code Quality Review** (2.5 hrs)
  - [ ] Run SonarCube locally: `mvn sonar:sonar`
  - [ ] Fix critical/high security issues
  - [ ] Fix code smells (duplication, complexity)
  - [ ] Add missing JavaDoc/comments
  - [ ] Verify secure coding practices:
    - [ ] Input validation on all endpoints
    - [ ] SQL injection prevention (JPA parameterized queries)
    - [ ] Authorization checks (role-based)
    - [ ] Audit logging on sensitive operations
    - [ ] Error messages don't leak system info
    - [ ] Timeout settings on external calls

- **Final Testing & Integration** (1 hr)
  - [ ] Run full test suite: `mvn clean test`
  - [ ] Integration tests across all features
  - [ ] Verify no breaking changes to existing functionality
  - [ ] Load test dashboard queries
  - [ ] Capture monitoring dashboard screenshots

**Deliverables:**
- ✅ All 7 SCRUM features implemented
- ✅ All tests passing
- ✅ SonarCube gate passed
- ✅ Dashboard screenshots captured
- ✅ Ready for commit

---

## 🧪 Testing Strategy

### Unit Tests (Per Component)
```
✅ PolicyEvaluationServiceTest
✅ AgentDraftPlanServiceTest
✅ AgentRunTraceServiceTest
✅ WorkerRestLogServiceTest
✅ ActionMonitoringServiceTest
✅ EscalationServiceTest
✅ ContactSupervisorServiceTest
```

### Integration Tests
```
✅ End-to-end policy → action dispatch flow
✅ Agent draft → supervisor approval → dispatch
✅ Worker concern → escalation flow
✅ Monitoring dashboard queries (performance)
```

### Local Testing Commands
```bash
# Build
mvn clean package

# Unit tests
mvn test

# Integration tests
mvn verify

# SonarCube analysis
mvn clean sonar:sonar

# Run application
mvn spring-boot:run
```

---

## 🛡️ Secure Coding Checklist

**For Every Feature:**
- [ ] Input validation (bean validation annotations)
- [ ] Authorization checks (@PreAuthorize)
- [ ] SQL injection prevention (JPA only)
- [ ] XSS prevention (REST API, no templates)
- [ ] CSRF protection (Spring Security default)
- [ ] Rate limiting consideration
- [ ] Timeout on external calls (Bedrock, etc.)
- [ ] Proper error handling (no stack traces in response)
- [ ] Audit logging for sensitive operations
- [ ] Dependency security (no vulnerable versions)

---

## 📊 Dashboard Capture
**Thursday afternoon - Capture these:**
1. Application Health: `http://localhost:8080/actuator/health`
2. Metrics: `http://localhost:8080/actuator/metrics`
3. API Docs: `http://localhost:8080/swagger-ui.html`
4. Custom Dashboard (if available)
5. Test Coverage Report: `target/site/jacoco/index.html`

---

## 📝 Git Workflow

### Branch Strategy
```bash
# Each SCRUM item gets its own branch
git checkout -b feat/scrum-NNN-description

# From main branch
git checkout main
git pull origin main
git checkout -b feat/scrum-117-policy-engine
```

### Commit Convention
```
[SCRUM-117] Implement deterministic policy evaluation engine

- Add PolicyEvaluationService with rule engine integration
- Add boundary and mixed-worker tests
- Add audit logging for policy decisions
- Verify no breaking changes to shift domain

Closes SCRUM-117
```

### Pre-Push Checklist
```bash
# 1. Ensure tests pass
mvn clean test

# 2. Run SonarCube locally
mvn sonar:sonar

# 3. Check for breaking changes
git diff main..HEAD -- backend/src/main/

# 4. Verify no security issues
# (Review SonarCube report)

# 5. Commit
git commit -m "[SCRUM-NNN] Description..."

# 6. Push
git push origin feat/scrum-NNN-description
```

---

## ⚠️ Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Breaking changes | Daily integration test run; validate against existing features |
| SonarCube failures | Fix issues daily, not at end of sprint |
| Test coverage gaps | Aim for >80% coverage per component |
| Database migration issues | Use Flyway for versioned migrations |
| Bedrock connectivity issues | Use mock for testing; verify credentials early |
| Performance regressions | Load test queries on Day 4 |

---

## 📋 Sign-Off

**Sprint Duration:** Aug 7-13, 2026  
**Total Hours:** 28 (7/day)  
**Developer:** Surya Kumaraguru  
**Team Members:** Abu Bakar Nasir, Bryan Phang, Jemilin, Tang Chee Seng, Justin Chua  

**Expected Outcome:**
- ✅ All 7 SCRUM items implemented
- ✅ 100% test pass rate
- ✅ SonarCube gate passed
- ✅ Zero security vulnerabilities
- ✅ Ready for GitHub PR + SonarCube scanning in CI/CD

---

**Status:** 📋 Planned | ⏳ In Progress | ✅ Complete

Update this file daily as you progress through the sprint!
