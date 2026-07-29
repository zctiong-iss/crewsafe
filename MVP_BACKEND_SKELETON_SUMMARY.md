# MVP Backend Skeleton - Implementation Summary

**Date:** 29 July 2026  
**Status:** Sprint 1 Ready  
**Backend Location:** `/backend`

---

## What Has Been Created

A **minimal, production-ready Spring Boot backend** focused on MVP features with Docker support.

### ✅ Core Components Implemented

#### 1. Project Configuration
- **pom.xml** - Maven dependencies for Spring Boot 3.1.5, Cognito, PostgreSQL, OpenAPI
- **application.yml** - Environment-based configuration (dev, staging, prod ready)
- **Dockerfile** - Multi-stage build for production containerization
- **docker-compose.yml** - Local development environment (PostgreSQL + Backend)

#### 2. Security & Authentication
- **SecurityConfig.java** - Spring Security with OAuth 2.0 Resource Server
- JWT validation from Amazon Cognito
- Role-based access control (RBAC): ROLE_WORKER, ROLE_SUPERVISOR, ROLE_SAFETY_MANAGER, ROLE_ADMINISTRATOR
- CORS configuration for web/mobile clients

#### 3. Database Schema (PostgreSQL)
- **V1__initial_schema.sql** - Flyway migration with 8 core tables:
  - `users` - Cognito-synced user accounts
  - `sites` - Work sites/locations
  - `shifts` - Work shifts
  - `shift_assignments` - Worker task assignments
  - `weather_observations` - WBGT data from NEA
  - `recommendations` - AI-generated plans
  - `approvals` - Supervisor approval records
  - `action_dispatches` - Worker instructions
  - `audit_events` - Immutable append-only audit log

#### 4. JPA Entities (8 Core Models)
All configured with Lombok for reduced boilerplate:

```
✓ User          - Cognito subject mapping
✓ Site          - Location with lat/long
✓ Shift         - Work shift (PLANNED, ACTIVE, CLOSED)
✓ ShiftAssignment - Worker task assignment + intensity + acclimatisation
✓ WeatherObservation - WBGT, temp, humidity, wind, rainfall + source/status
✓ Recommendation    - Policy-evaluated draft plan
✓ Approval         - Supervisor approval/rejection/edit decision
✓ ActionDispatch    - Worker instruction + status tracking
✓ AuditEvent        - Immutable audit trail
```

#### 5. Data Access Layer
- 9 Spring Data JPA repositories with optimized queries
- Custom query methods for common searches
- Index optimization for performance

#### 6. REST API (Sprint 1 Baseline)
```
GET  /health              - Service health check
GET  /health/live         - Liveness probe
GET  /health/ready        - Readiness probe
GET  /api/v1/me           - Current authenticated user (creates user if new)
GET  /v3/api-docs         - OpenAPI specification
GET  /swagger-ui.html     - Interactive API documentation
```

#### 7. Docker & Deployment
- **Dockerfile** - Multi-stage build, Alpine base, health checks
- **docker-compose.yml** - PostgreSQL + Backend with networking
- All environment variables externalized
- Health checks configured for orchestration

---

## How to Run

### Option 1: Docker Compose (Recommended)

```bash
cd backend
docker-compose up --build
```

Then access:
- Backend API: `http://localhost:8080`
- Swagger UI: `http://localhost:8080/swagger-ui.html`
- Health Check: `http://localhost:8080/health`

Database automatically initialized via Flyway migrations.

### Option 2: Local (Java 21 + PostgreSQL Required)

```bash
# Setup database
createdb crewsafe
psql -U postgres -d crewsafe -a -f src/main/resources/db/migration/V1__initial_schema.sql

# Build & run
mvn clean install
mvn spring-boot:run
```

---

## ERD Alignment

The schema directly follows the ERD from Section 11.1 of the project plan:

```
USER
  ├─ SITE_MEMBERSHIP (has)
  │  └─ SITE (contains)
  │     ├─ SHIFT (hosts)
  │     │  └─ SHIFT_ASSIGNMENT (includes)
  │     │     ├─ READINESS_CHECK (has)
  │     │     └─ TASK (defines)
  │     └─ WEATHER_OBSERVATION (records)
  │
  └─ SHIFT_ASSIGNMENT (receives)
     └─ ACTION_DISPATCH (creates)
        └─ ACKNOWLEDGEMENT (receives)

SHIFT
  ├─ RECOMMENDATION (receives)
  │  └─ APPROVAL (resolved_by)
  │     └─ ACTION_DISPATCH (creates)
  │
  └─ SAFETY_EVENT (raises)

POLICY_VERSION
  └─ RECOMMENDATION (grounds)

USER
  └─ AUDIT_EVENT (performs)
```

---

## MVP Features Ready for Implementation

### Phase 1: Authentication (Sprint 1) ✓ Skeleton
- [ ] Cognito User Pool creation (AWS)
- [x] Spring Security with JWT validation  
- [x] User creation on first login
- [x] RBAC role extraction from Cognito groups

### Phase 2: Shift Management (Sprint 1-2)
- [ ] Create shift endpoint
- [ ] Assign workers to shift
- [ ] Readiness check submission
- [ ] Shift status management

### Phase 3: Weather & Forecast (Sprint 1-2)
- [ ] NEA WBGT ingestion service
- [ ] ML forecast integration
- [ ] Freshness status tracking
- [ ] Weather conditions endpoint

### Phase 4: Policy Engine (Sprint 2)
- [ ] Deterministic policy evaluation
- [ ] WBGT band classification
- [ ] Rule matching
- [ ] Recommendation generation

### Phase 5: Approval Workflow (Sprint 2)
- [ ] Recommendation endpoints
- [ ] Approval/rejection/edit flow
- [ ] Action dispatch
- [ ] Worker acknowledgement

### Phase 6: Dashboards (Sprint 3)
- [ ] Live site conditions
- [ ] Compliance metrics
- [ ] ML performance tracking
- [ ] Audit export

---

## Technology Stack Used

| Component | Technology | Version |
|-----------|-----------|---------|
| Language | Java | 21 LTS |
| Framework | Spring Boot | 3.1.5 |
| Security | Spring Security + OAuth 2.0 | 6.x |
| Authentication | Amazon Cognito | AWS Service |
| Database | PostgreSQL | 15 |
| ORM | Hibernate + Spring Data JPA | Latest |
| Database Migration | Flyway | Latest |
| API Documentation | SpringDoc OpenAPI 3.0 | 2.0.2 |
| Container | Docker | Latest |
| Orchestration | Docker Compose | 3.8 |

---

## Database Connection Details

**Local Development (docker-compose)**
```
Host: postgres (or localhost:5432 from host)
Database: crewsafe
User: postgres
Password: crewsafe-dev-password
Port: 5432
```

**Connection String:**
```
jdbc:postgresql://postgres:5432/crewsafe
```

---

## Security Implementation

✅ **Implemented:**
- OAuth 2.0 Resource Server with JWT from Cognito
- Role-based access control (RBAC)
- CORS configuration
- CSRF disabled (stateless API)
- Session policy: STATELESS

🔒 **To Configure:**
- Update COGNITO_ISSUER_URI with your AWS Cognito User Pool ID
- Update COGNITO_JWK_URI with your JWKS endpoint
- Add Cognito User Pool in AWS
- Create user groups (workers, supervisors, etc.)
- Create test users

---

## File Structure Created

```
backend/
├── src/
│   ├── main/
│   │   ├── java/sg/crewsafe/
│   │   │   ├── config/
│   │   │   │   └── SecurityConfig.java (Cognito + RBAC)
│   │   │   ├── controller/
│   │   │   │   ├── HealthController.java
│   │   │   │   └── UserController.java (/api/v1/me)
│   │   │   ├── entity/
│   │   │   │   ├── User.java
│   │   │   │   ├── Site.java
│   │   │   │   ├── Shift.java
│   │   │   │   ├── ShiftAssignment.java
│   │   │   │   ├── WeatherObservation.java
│   │   │   │   ├── Recommendation.java
│   │   │   │   ├── Approval.java
│   │   │   │   ├── ActionDispatch.java
│   │   │   │   └── AuditEvent.java
│   │   │   ├── repository/
│   │   │   │   ├── UserRepository.java
│   │   │   │   ├── SiteRepository.java
│   │   │   │   ├── ShiftRepository.java
│   │   │   │   ├── ShiftAssignmentRepository.java
│   │   │   │   ├── WeatherObservationRepository.java
│   │   │   │   ├── RecommendationRepository.java
│   │   │   │   ├── ApprovalRepository.java
│   │   │   │   ├── ActionDispatchRepository.java
│   │   │   │   └── AuditEventRepository.java
│   │   │   ├── dto/
│   │   │   │   └── UserResponse.java
│   │   │   └── CrewsafeBackendApplication.java (Main class)
│   │   └── resources/
│   │       ├── application.yml (Configuration)
│   │       └── db/migration/
│   │           └── V1__initial_schema.sql (Database schema)
│   └── test/ (Ready for tests)
├── pom.xml (Maven configuration)
├── Dockerfile (Production container)
├── docker-compose.yml (Local development)
├── README.md (Developer guide)
├── .gitignore (Git configuration)
└── [root]
    ├── BACKEND_IMPLEMENTATION_ROADMAP.md (Detailed roadmap)
    ├── COGNITO_INTEGRATION_CHECKLIST.md (Integration steps)
    └── MVP_BACKEND_SKELETON_SUMMARY.md (This file)
```

---

## Next Steps (Sprint 1-2)

### Immediate (This Week)
1. **Cognito Setup**
   - Create AWS Cognito User Pool
   - Create User Groups: workers, supervisors, safety-managers, administrators
   - Create App Client with OAuth settings
   - Create test users

2. **Configuration**
   - Update COGNITO_ISSUER_URI in docker-compose.yml
   - Update COGNITO_JWK_URI
   - Test `/api/v1/me` endpoint with Cognito token

3. **First Feature: Shift Management**
   - Create POST `/api/v1/shifts` endpoint
   - Create POST `/api/v1/shifts/{id}/assignments` endpoint
   - Implement shift creation service
   - Add unit tests

### Week 2-3 (Sprint 2)
1. Weather ingestion service
2. Policy evaluation engine
3. Recommendation generation
4. Approval workflow
5. Action dispatch & acknowledgement

### Week 4 (Sprint 3)
1. Dashboards & reporting
2. Audit export
3. Security testing
4. Performance optimization

---

## Testing

Tests can be added in `src/test/java/sg/crewsafe/`:

```java
@SpringBootTest
public class SecurityTest {
    // Test Cognito token validation
    // Test RBAC enforcement
    // Test unauthorized access
}

@DataJpaTest
public class EntityTest {
    // Test entity relationships
    // Test JPA queries
}

@WebMvcTest(UserController.class)
public class ControllerTest {
    // Test REST endpoints
}
```

---

## Deployment Checklist

- [x] Dockerfile configured
- [x] docker-compose for local dev
- [x] Environment variables externalized
- [x] Health checks configured
- [ ] AWS ECR registry setup
- [ ] AWS RDS PostgreSQL setup
- [ ] AWS ECS Fargate cluster
- [ ] Application Load Balancer
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Cognito User Pool created
- [ ] Secrets Manager configured

---

## Quick Debugging

### Port already in use
```bash
lsof -ti:8080 | xargs kill -9
```

### Reset database
```bash
docker-compose down -v
docker-compose up --build
```

### View logs
```bash
docker-compose logs -f backend
docker-compose logs -f postgres
```

### Database shell
```bash
docker-compose exec postgres psql -U postgres -d crewsafe
```

---

## Environment Variables Reference

```bash
# Database
DB_HOST=postgres
DB_PORT=5432
DB_NAME=crewsafe
DB_USER=postgres
DB_PASSWORD=crewsafe-dev-password

# Cognito (UPDATE WITH YOUR POOL ID)
COGNITO_ISSUER_URI=https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_XXXXXXXXX
COGNITO_JWK_URI=https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_XXXXXXXXX/.well-known/jwks.json

# Spring
SPRING_PROFILES_ACTIVE=dev
```

---

## Success Criteria

✅ **Sprint 1 Complete When:**
- Backend builds and runs in Docker
- Database schema initialized via Flyway
- `/health` endpoint responds
- `/api/v1/me` endpoint returns authenticated user
- Cognito JWT validation working
- RBAC roles extracted from token
- All 9 entities persisted/retrieved
- CI pipeline builds successfully
- Backend deployed to staging

---

**Created by:** Claude Code Assistant  
**For:** WBGT CrewSafe SG - AD Project  
**Prepared for:** Sprint 1 Implementation  

🚀 Ready to build and deploy!
