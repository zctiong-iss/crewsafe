# WBGT CrewSafe SG - Backend API

Spring Boot REST API for heat stress management system with Amazon Cognito authentication.

## Quick Start with Docker

### Prerequisites
- Docker & Docker Compose installed
- Java 21+ (for local development without Docker)

### Run with Docker Compose

```bash
cd backend
docker-compose up --build
```

The backend will be available at `http://localhost:8080`

### Database & Services

- **PostgreSQL**: `localhost:5432`
  - Database: `crewsafe`
  - User: `postgres`
  - Password: `crewsafe-dev-password`

- **Backend API**: `http://localhost:8080`
  - Health: `http://localhost:8080/health`
  - API Docs: `http://localhost:8080/swagger-ui.html`

## Local Development (Without Docker)

### Prerequisites
- Java 21 JDK
- PostgreSQL 15+
- Maven 3.9+

### Setup Database

```bash
# Create database
createdb crewsafe

# Create user
createuser -P postgres  # password: crewsafe-dev-password
```

### Build & Run

```bash
# Build
mvn clean install

# Run
mvn spring-boot:run
```

## Environment Variables

Configure these in `docker-compose.yml` or local environment:

```bash
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=crewsafe
DB_USER=postgres
DB_PASSWORD=crewsafe-dev-password

# Cognito (update with your AWS credentials)
COGNITO_ISSUER_URI=https://cognito-idp.ap-southeast-1.amazonaws.com/YOUR_POOL_ID
COGNITO_JWK_URI=https://cognito-idp.ap-southeast-1.amazonaws.com/YOUR_POOL_ID/.well-known/jwks.json
```

## API Endpoints (MVP)

### Authentication
- `GET /api/v1/me` - Current user (requires JWT)
- `GET /health` - Service health check

### API Documentation
- `GET /v3/api-docs` - OpenAPI specification
- `GET /swagger-ui.html` - Interactive API documentation

## Project Structure

```
backend/
├── src/main/java/sg/crewsafe/
│   ├── config/          # Spring configuration
│   ├── controller/      # REST controllers
│   ├── entity/          # JPA entities
│   ├── repository/      # Data access layer
│   ├── dto/             # Data transfer objects
│   └── CrewsafeBackendApplication.java
├── src/main/resources/
│   ├── application.yml  # Configuration
│   └── db/migration/    # Flyway migrations
├── pom.xml              # Maven dependencies
├── Dockerfile           # Docker build
└── docker-compose.yml   # Local dev environment
```

## Database Schema

Core entities:
- **users** - User accounts from Cognito
- **sites** - Work sites/locations
- **shifts** - Work shifts
- **shift_assignments** - Worker task assignments
- **weather_observations** - WBGT and weather data
- **recommendations** - AI-generated safety plans
- **approvals** - Supervisor approvals
- **action_dispatches** - Worker instructions
- **audit_events** - Immutable audit log

See `src/main/resources/db/migration/` for full schema.

## Security

- OAuth 2.0 Resource Server with JWT validation from Cognito
- Role-based access control (RBAC):
  - `ROLE_WORKER` - Field workers
  - `ROLE_SUPERVISOR` - Crew supervisors
  - `ROLE_SAFETY_MANAGER` - Safety managers
  - `ROLE_ADMINISTRATOR` - System admins

## Troubleshooting

### Connection refused error
- Ensure PostgreSQL is running
- Check DB credentials match `docker-compose.yml`

### JWT validation errors
- Verify Cognito pool ID in environment variables
- Ensure COGNITO_ISSUER_URI and COGNITO_JWK_URI are correct

### Port already in use
```bash
# Change port in application.yml or docker-compose.yml
# Or kill existing process:
lsof -ti:8080 | xargs kill -9  # Linux/Mac
```

## Next Steps

1. Configure Cognito User Pool in AWS
2. Create test users in Cognito
3. Update COGNITO_ISSUER_URI and COGNITO_JWK_URI
4. Implement additional endpoints (shifts, recommendations, etc.)
5. Add integration tests

## Documentation

- [Architecture Decisions](../BACKEND_IMPLEMENTATION_ROADMAP.md)
- [Cognito Integration Checklist](../COGNITO_INTEGRATION_CHECKLIST.md)
- [Project Plan](../WBGT-CrewSafe-SG-AD-Project-Plan.md)

## Contributing

1. Create feature branch: `git checkout -b feature/your-feature`
2. Commit changes: `git commit -am 'Add feature'`
3. Push to branch: `git push origin feature/your-feature`
4. Submit pull request

## License

Proprietary - WBGT CrewSafe SG Project
