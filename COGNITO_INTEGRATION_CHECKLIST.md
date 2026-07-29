# Amazon Cognito Integration Checklist for WBGT CrewSafe SG Backend

## Quick Reference Guide

### Phase 1: Cognito Setup (Pre-Development)

- [ ] **Create AWS Cognito User Pool**
  - Pool name: `crewsafe-user-pool`
  - Password policy: Min 12 chars, uppercase, lowercase, number, special
  - MFA: Optional (TOTP or SMS)
  - Email verification: Enabled
  
- [ ] **Create App Client**
  - Client name: `crewsafe-backend`
  - Authentication flows: ADMIN_NO_SRP_AUTH, ALLOW_REFRESH_TOKEN_AUTH
  - Token expiry: Access token = 1 hour, Refresh token = 30 days
  - Callback URL: `http://localhost:8080/login/oauth2/code/cognito` (dev)

- [ ] **Create User Groups in Cognito**
  ```
  - workers
  - supervisors
  - safety-managers
  - administrators
  ```

- [ ] **Create Seed Users for Testing**
  ```
  Test Users:
  - worker1@crewsafe.dev → Group: workers
  - supervisor1@crewsafe.dev → Group: supervisors
  - manager1@crewsafe.dev → Group: safety-managers
  - admin1@crewsafe.dev → Group: administrators
  ```

- [ ] **Store Cognito Credentials Securely**
  - User Pool ID: `XXXXX`
  - Client ID: `XXXXX`
  - Client Secret: `XXXXX` (in AWS Secrets Manager)
  - Region: `ap-southeast-1` (Singapore)

---

### Phase 2: Spring Boot Setup (Sprint 1)

#### Dependencies

```xml
<!-- Spring Boot & Security -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-security</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.security</groupId>
    <artifactId>spring-security-oauth2-resource-server</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.security</groupId>
    <artifactId>spring-security-oauth2-jose</artifactId>
</dependency>

<!-- Database -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-jpa</artifactId>
</dependency>
<dependency>
    <groupId>org.postgresql</groupId>
    <artifactId>postgresql</artifactId>
    <scope>runtime</scope>
</dependency>
<dependency>
    <groupId>org.flywaydb</groupId>
    <artifactId>flyway-core</artifactId>
</dependency>

<!-- API Documentation -->
<dependency>
    <groupId>org.springdoc</groupId>
    <artifactId>springdoc-openapi-starter-webmvc-ui</artifactId>
    <version>2.0.2</version>
</dependency>

<!-- Resilience -->
<dependency>
    <groupId>io.github.resilience4j</groupId>
    <artifactId>resilience4j-spring-boot3</artifactId>
    <version>2.0.2</version>
</dependency>

<!-- Testing -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-test</artifactId>
    <scope>test</scope>
</dependency>
<dependency>
    <groupId>org.springframework.security</groupId>
    <artifactId>spring-security-test</artifactId>
    <scope>test</scope>
</dependency>
```

#### Application Configuration

- [ ] **application.yml**
```yaml
spring:
  application:
    name: crewsafe-backend
  jpa:
    hibernate:
      ddl-auto: validate
    show-sql: false
  datasource:
    url: jdbc:postgresql://localhost:5432/crewsafe
    username: postgres
    password: ${DB_PASSWORD}
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: https://cognito-idp.ap-southeast-1.amazonaws.com/${COGNITO_POOL_ID}
          jwk-set-uri: https://cognito-idp.ap-southeast-1.amazonaws.com/${COGNITO_POOL_ID}/.well-known/jwks.json

logging:
  level:
    root: INFO
    sg.crewsafe: DEBUG
```

- [ ] **Secrets Management**
  - Store in AWS Secrets Manager:
    - COGNITO_POOL_ID
    - COGNITO_CLIENT_ID
    - DB_PASSWORD
    - ML_SERVICE_API_KEY

---

### Phase 3: Core Implementation (Sprint 1-2)

#### Authentication Layer

- [ ] **JwtAuthenticationConverter Bean**
  - Extract groups from `cognito:groups` claim
  - Convert to Spring ROLE_* authorities
  - Create UserDetails from JWT claims

- [ ] **SecurityConfig**
  - Permit `/api/v1/auth/login` and `/health`
  - Require authentication for all other endpoints
  - Configure role-based access on endpoints

- [ ] **AuthController**
  ```java
  @PostMapping("/api/v1/auth/login")
  public LoginResponse login(@RequestBody LoginRequest request) {
    // Delegate to Cognito via InitiateAuth
    // Return access + refresh tokens
  }
  
  @GetMapping("/api/v1/me")
  @PreAuthorize("isAuthenticated()")
  public UserResponse getCurrentUser() {
    // Extract from SecurityContext
    // Return user + site memberships
  }
  ```

#### Authorization Layer

- [ ] **Site-Scoped Authorization**
  ```java
  @Component
  public class SiteAuthorizationManager {
    public boolean canAccessSite(UUID siteId, String userId) {
      // Check if user has SiteMembership for siteId
      return siteMembershipRepository
        .existsByUserCognitoSubjectAndSiteId(userId, siteId);
    }
  }
  ```

- [ ] **Role Enforcement**
  ```java
  @GetMapping("/api/v1/recommendations/{id}/decision")
  @PreAuthorize("hasRole('SUPERVISOR')")
  public void approveRecommendation(...) {}
  
  @GetMapping("/api/v1/reports/compliance")
  @PreAuthorize("hasRole('SAFETY_MANAGER')")
  public ComplianceReport getReport(...) {}
  ```

#### Entity Mapping

- [ ] **User Entity with Cognito Subject**
  ```java
  @Entity
  public class User {
    @Id private UUID id = UUID.randomUUID();
    
    @Column(unique = true, nullable = false)
    private String cognitoSubject; // From JWT 'sub' claim
    
    private String email;
    private String displayName;
    private LocalDateTime createdAt = LocalDateTime.now();
  }
  ```

- [ ] **Sync User from Cognito**
  - On first login, create User record from JWT claims
  - Update displayName, email on subsequent logins
  - Map Cognito groups to SiteMembership roles

#### Database Setup

- [ ] **Flyway Migrations**
  ```
  V1__initial_schema.sql
  - users table
  - sites table
  - site_memberships table
  - roles enum
  
  V2__shift_and_assignment.sql
  - shifts table
  - shift_assignments table
  - tasks table
  
  V3__weather_and_forecast.sql
  - weather_observations table
  - wbgt_forecasts table
  - lightning_observations table
  
  V4__recommendations_and_audit.sql
  - recommendations table
  - approvals table
  - action_dispatches table
  - acknowledgements table
  - audit_events table (append-only)
  ```

- [ ] **Repository Interfaces**
  ```java
  public interface UserRepository extends JpaRepository<User, UUID> {
    Optional<User> findByCognitoSubject(String cognitoSubject);
  }
  
  public interface SiteMembershipRepository 
    extends JpaRepository<SiteMembership, UUID> {
    boolean existsByUserCognitoSubjectAndSiteId(...);
    List<SiteMembership> findByUserCognitoSubject(String subject);
  }
  
  // Similar for all entities
  ```

---

### Phase 4: Feature Endpoints (Sprint 2-3)

#### Core Business APIs

- [ ] **GET /api/v1/sites/{siteId}/conditions**
  - Returns: Current WBGT, band, forecast, freshness, lightning risk
  - Requires: User assignment to site
  - Authorization: Site-scoped

- [ ] **POST /api/v1/shifts**
  - Creates shift with assignments
  - Requires: SUPERVISOR role
  - Authorization: Can only create for assigned sites

- [ ] **POST /api/v1/shifts/{shiftId}/recommendations/generate**
  - Calls policy engine
  - Returns: Draft plan with matched rules
  - Requires: SUPERVISOR role

- [ ] **POST /api/v1/recommendations/{id}/decision**
  - Approve, edit, or reject
  - Requires: SUPERVISOR role
  - Triggers: Action dispatch if approved

- [ ] **GET /api/v1/me/actions**
  - Returns: Worker's pending/acknowledged actions
  - Requires: WORKER role

- [ ] **POST /api/v1/actions/{id}/acknowledge**
  - Idempotent acknowledgement
  - Requires: Affected worker

---

### Phase 5: Testing (Throughout)

#### Unit Tests

- [ ] **AuthenticationTest**
  - Valid JWT token accepted
  - Expired token rejected
  - Invalid signature rejected
  - Missing token rejected

- [ ] **AuthorizationTest**
  - Worker cannot approve recommendations
  - Supervisor cannot access safety-manager reports
  - User cannot access other sites' data

- [ ] **PolicyEngineTest**
  - WBGT 32-33°C + HEAVY = REST_10_MIN
  - WBGT 33°C+ + HEAVY = REST_15_MIN
  - New worker = acclimatisation rules apply

#### Integration Tests

- [ ] **End-to-End Shift Workflow**
  - Create shift → Assign workers → Generate recommendation → Approve → Dispatch → Acknowledge

- [ ] **Authorization Boundary**
  - User A cannot see User B's actions
  - Supervisor cannot approve for wrong site

- [ ] **Audit Trail Completeness**
  - Every action creates audit event
  - Audit events are immutable

#### Security Tests

- [ ] **SQL Injection Test**
  - Parameterized queries used
  - No string concatenation in queries

- [ ] **XSS Prevention**
  - Input validation on all endpoints
  - Output encoding in responses

- [ ] **CSRF Protection**
  - CSRF tokens for state-changing requests (if not using OAuth)
  - SameSite cookie attribute set

- [ ] **Authentication Bypass**
  - Unauthenticated requests rejected
  - Token expiry enforced
  - Refresh token flow tested

---

### Phase 6: Deployment (Sprint 3)

#### AWS Infrastructure

- [ ] **RDS PostgreSQL Setup**
  - Database: crewsafe
  - User: crewsafe_app
  - Multi-AZ: Yes (for production)
  - Backup: Daily, 7-day retention

- [ ] **ECS Fargate Cluster**
  - Container image: `{account}.dkr.ecr.{region}.amazonaws.com/crewsafe-backend`
  - CPU: 0.5-1 vCPU
  - Memory: 1-2 GB
  - Auto-scaling: 2-4 tasks

- [ ] **Application Load Balancer**
  - Health check: `/health`
  - Stickiness: Disabled (stateless)
  - TLS: Enabled
  - Certificate: ACM

- [ ] **Secrets Manager**
  - Store Cognito credentials
  - Store database password
  - Rotate regularly

#### CI/CD Pipeline

- [ ] **GitHub Actions Workflow**
  ```
  PR triggers:
  1. Compile & build
  2. Unit tests
  3. SAST (SonarQube)
  4. Dependency scan (Dependabot)
  5. Container scan (Trivy)
  
  Merge to main:
  6. Build Docker image
  7. Push to ECR
  8. Deploy to staging
  9. Run integration tests
  10. Deploy to production (manual approval)
  ```

- [ ] **Health Checks**
  - Liveness: `/health/live`
  - Readiness: `/health/ready`
  - Both checked before routing traffic

#### Monitoring & Observability

- [ ] **CloudWatch Logs**
  - Structured JSON logging
  - Correlation IDs on all requests
  - Log retention: 30 days (adjustable)

- [ ] **Metrics**
  - Request count, latency, errors
  - Authentication success/failures
  - Database connection pool
  - External API failures

- [ ] **Alarms**
  - High error rate (>5%)
  - High latency (p95 > 2s)
  - Pod restarts
  - Database connection exhaustion

---

### Success Criteria Checklist

#### Sprint 1 Exit Criteria
- [ ] Cognito User Pool created and users seeded
- [ ] Spring Boot app boots with JWT validation
- [ ] `/api/v1/me` endpoint returns authenticated user
- [ ] Role-based access control works
- [ ] Database schema created and migrations run
- [ ] Core entities persisted and retrieved
- [ ] Weather endpoint returns current conditions
- [ ] CI pipeline builds and runs tests automatically
- [ ] Backend deployed to staging

#### Sprint 2 Exit Criteria
- [ ] All recommendation endpoints working
- [ ] Policy engine evaluates rules correctly
- [ ] Approval workflow complete
- [ ] Action dispatch sends to workers
- [ ] Acknowledgement stored with idempotency
- [ ] Audit events created for all actions
- [ ] Lightning risk assessed and shown
- [ ] Integration tests pass end-to-end
- [ ] Security scan passes with no high findings

#### Sprint 3 Exit Criteria
- [ ] All dashboards return correct metrics
- [ ] Export endpoint provides complete audit trail
- [ ] Multi-site safety-manager view works
- [ ] All 20 UAT scenarios pass
- [ ] Security remediation complete
- [ ] Performance targets met (p95 latency)
- [ ] Accessibility checks pass
- [ ] Demo ready and tested

---

### Key Files to Create

```
backend/
├── src/main/java/sg/crewsafe/
│   ├── config/
│   │   ├── SecurityConfig.java
│   │   └── JwtConfiguration.java
│   ├── controller/
│   │   ├── AuthController.java
│   │   ├── SiteController.java
│   │   ├── ShiftController.java
│   │   ├── RecommendationController.java
│   │   ├── ActionController.java
│   │   ├── ReportController.java
│   │   └── AuditController.java
│   ├── service/
│   │   ├── AuthenticationService.java
│   │   ├── AuthorizationService.java
│   │   ├── ShiftService.java
│   │   ├── PolicyEvaluationService.java
│   │   ├── RecommendationService.java
│   │   ├── ActionDispatchService.java
│   │   ├── NEAWeatherService.java
│   │   ├── MLForecastService.java
│   │   └── AuditService.java
│   ├── entity/
│   │   ├── User.java
│   │   ├── Site.java
│   │   ├── Shift.java
│   │   ├── ShiftAssignment.java
│   │   ├── WeatherObservation.java
│   │   ├── Recommendation.java
│   │   ├── ActionDispatch.java
│   │   ├── AuditEvent.java
│   │   └── [all other entities]
│   ├── repository/
│   │   ├── UserRepository.java
│   │   ├── SiteRepository.java
│   │   ├── [all repositories]
│   ├── dto/
│   │   ├── LoginRequest.java
│   │   ├── UserResponse.java
│   │   ├── SiteConditionsResponse.java
│   │   └── [all DTOs]
│   ├── security/
│   │   ├── JwtAuthenticationConverter.java
│   │   └── SiteAuthorizationManager.java
│   └── CrewsafeBackendApplication.java
├── src/main/resources/
│   ├── application.yml
│   ├── application-dev.yml
│   ├── application-staging.yml
│   ├── application-prod.yml
│   └── db/migration/
│       ├── V1__initial_schema.sql
│       ├── V2__shift_schema.sql
│       └── [all migrations]
├── src/test/java/sg/crewsafe/
│   ├── AuthenticationTest.java
│   ├── AuthorizationTest.java
│   ├── PolicyEngineTest.java
│   ├── RecommendationWorkflowTest.java
│   └── [all tests]
├── Dockerfile
├── docker-compose.yml
├── pom.xml
└── README.md
```

---

### Important Notes

1. **Never commit Cognito secrets** - Use AWS Secrets Manager or environment variables
2. **Always use HTTPS** - Even in development, use self-signed certs
3. **Token validation is critical** - Validate issuer, audience, and expiration
4. **Test with real Cognito tokens** - Don't mock JWT validation in integration tests
5. **Implement proper error handling** - External service failures should be recoverable
6. **Use correlation IDs** - Link requests across services for debugging
7. **Log security events** - Authentication failures, authorization denials
8. **Monitor token usage** - Track refresh token usage, detect stolen tokens

---

**Document Status:** Sprint 1 Ready  
**Next Step:** Create AWS Cognito User Pool and begin Spring Boot setup
