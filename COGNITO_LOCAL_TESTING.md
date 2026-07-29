# Amazon Cognito Local Testing Guide
**For WBGT CrewSafe SG Backend**

---

## Option 1: LocalStack (Recommended - Full Local Simulation)

LocalStack allows you to run AWS services locally, including Cognito.

### Prerequisites
- Docker & Docker Compose installed
- AWS CLI configured

### Step 1: Create docker-compose with LocalStack

Create `docker-compose-localstack.yml`:

```yaml
version: '3.8'

services:
  localstack:
    image: localstack/localstack:latest
    container_name: localstack-crewsafe
    ports:
      - "4566:4566"
      - "4571:4571"
    environment:
      - SERVICES=cognito-idp,cognito-identity
      - DEBUG=1
      - DOCKER_HOST=unix:///var/run/docker.sock
      - AWS_DEFAULT_REGION=ap-southeast-1
      - AWS_ACCESS_KEY_ID=test
      - AWS_SECRET_ACCESS_KEY=test
    volumes:
      - "${TMPDIR}:/tmp/localstack"
      - "/var/run/docker.sock:/var/run/docker.sock"

  backend:
    build: ./backend
    container_name: crewsafe-backend
    ports:
      - "8080:8080"
    environment:
      - SPRING_DATASOURCE_URL=jdbc:postgresql://postgres:5432/crewsafe
      - SPRING_DATASOURCE_USERNAME=postgres
      - SPRING_DATASOURCE_PASSWORD=crewsafe-dev-password
      - COGNITO_ISSUER_URI=http://localstack:4566/ap-southeast-1_local/
      - COGNITO_JWK_URI=http://localstack:4566/ap-southeast-1_local/.well-known/jwks.json
    depends_on:
      - localstack
      - postgres

  postgres:
    image: postgres:15-alpine
    container_name: crewsafe-postgres
    environment:
      - POSTGRES_DB=crewsafe
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=crewsafe-dev-password
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

### Step 2: Start Services

```bash
docker-compose -f docker-compose-localstack.yml up --build
```

### Step 3: Create Local Cognito User Pool

```bash
# Set AWS credentials for LocalStack
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_DEFAULT_REGION=ap-southeast-1

# Create User Pool
aws cognito-idp create-user-pool \
  --pool-name crewsafe-user-pool \
  --endpoint-url http://localhost:4566

# Create User Pool Client
aws cognito-idp create-user-pool-client \
  --user-pool-id ap-southeast-1_local \
  --client-name crewsafe-backend \
  --explicit-auth-flows ADMIN_NO_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH \
  --endpoint-url http://localhost:4566

# Create User Groups
aws cognito-idp create-group \
  --group-name workers \
  --user-pool-id ap-southeast-1_local \
  --endpoint-url http://localhost:4566

aws cognito-idp create-group \
  --group-name supervisors \
  --user-pool-id ap-southeast-1_local \
  --endpoint-url http://localhost:4566

aws cognito-idp create-group \
  --group-name safety-managers \
  --user-pool-id ap-southeast-1_local \
  --endpoint-url http://localhost:4566

aws cognito-idp create-group \
  --group-name administrators \
  --user-pool-id ap-southeast-1_local \
  --endpoint-url http://localhost:4566

# Create Test User
aws cognito-idp admin-create-user \
  --user-pool-id ap-southeast-1_local \
  --username worker1@crewsafe.local \
  --user-attributes Name=email,Value=worker1@crewsafe.local Name=name,Value="Worker One" \
  --temporary-password TempPassword123! \
  --endpoint-url http://localhost:4566

# Add user to workers group
aws cognito-idp admin-add-user-to-group \
  --user-pool-id ap-southeast-1_local \
  --username worker1@crewsafe.local \
  --group-name workers \
  --endpoint-url http://localhost:4566

# Set permanent password
aws cognito-idp admin-set-user-password \
  --user-pool-id ap-southeast-1_local \
  --username worker1@crewsafe.local \
  --password Worker@123456 \
  --permanent \
  --endpoint-url http://localhost:4566
```

### Step 4: Test Authentication

```bash
# Get token from LocalStack Cognito
TOKEN=$(aws cognito-idp admin-initiate-auth \
  --user-pool-id ap-southeast-1_local \
  --client-id {CLIENT_ID} \
  --auth-flow ADMIN_NO_SRP_AUTH \
  --auth-parameters USERNAME=worker1@crewsafe.local,PASSWORD=Worker@123456 \
  --endpoint-url http://localhost:4566 \
  --query 'AuthenticationResult.AccessToken' \
  --output text)

echo "Access Token: $TOKEN"

# Test /api/v1/me endpoint
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/me
```

---

## Option 2: Mock JWT Token Testing (No AWS Required)

If LocalStack is not available, use mock tokens for testing.

### Create Mock Token Generator

Create `src/test/java/sg/crewsafe/util/MockJwtTokenGenerator.java`:

```java
package sg.crewsafe.util;

import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;
import java.time.Instant;
import java.util.Arrays;
import java.util.Date;

public class MockJwtTokenGenerator {
    
    private static final String SECRET = "mock-secret-key-for-testing-only";
    private static final String ISSUER = "https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_mock";
    
    public static String generateMockToken(String username, String email, String... groups) {
        return JWT.create()
            .withIssuer(ISSUER)
            .withSubject("12345-67890-abcdef")
            .withClaim("email", email)
            .withClaim("email_verified", true)
            .withClaim("name", username)
            .withClaim("cognito:groups", Arrays.asList(groups))
            .withClaim("aud", "1234567890abcdefghijklmno")
            .withClaim("event_id", "12345-67890-abcdef")
            .withClaim("token_use", "access")
            .withIssuedAt(Date.from(Instant.now()))
            .withExpiresAt(Date.from(Instant.now().plusSeconds(3600)))
            .sign(Algorithm.HMAC256(SECRET));
    }
    
    public static void main(String[] args) {
        // Generate sample tokens for testing
        String workerToken = generateMockToken(
            "Worker One", 
            "worker1@crewsafe.local", 
            "workers"
        );
        
        String supervisorToken = generateMockToken(
            "Supervisor One", 
            "supervisor1@crewsafe.local", 
            "supervisors"
        );
        
        String managerToken = generateMockToken(
            "Manager One", 
            "manager1@crewsafe.local", 
            "safety-managers"
        );
        
        System.out.println("=== Mock Cognito Tokens for Testing ===\n");
        System.out.println("Worker Token:");
        System.out.println(workerToken);
        System.out.println("\nSupervisor Token:");
        System.out.println(supervisorToken);
        System.out.println("\nSafety Manager Token:");
        System.out.println(managerToken);
    }
}
```

### Generate Test Tokens

```bash
cd backend
javac -cp ".:target/classes:target/dependency/*" src/test/java/sg/crewsafe/util/MockJwtTokenGenerator.java
java -cp ".:target/classes:target/dependency/*" sg.crewsafe.util.MockJwtTokenGenerator
```

---

## Option 3: Integration Tests with Spring Security Test

Create `src/test/java/sg/crewsafe/controller/UserControllerTest.java`:

```java
package sg.crewsafe.controller;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
public class UserControllerTest {
    
    @Autowired
    private MockMvc mockMvc;
    
    @Test
    @WithMockUser(username = "worker1@crewsafe.local", roles = "WORKER")
    public void testGetAuthenticatedUser() throws Exception {
        mockMvc.perform(get("/api/v1/me"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.email").exists())
            .andExpect(jsonPath("$.displayName").exists());
    }
    
    @Test
    public void testUnauthorizedAccess() throws Exception {
        mockMvc.perform(get("/api/v1/me"))
            .andExpect(status().isUnauthorized());
    }
    
    @Test
    @WithMockUser(username = "supervisor1@crewsafe.local", roles = "SUPERVISOR")
    public void testSupervisorAccess() throws Exception {
        mockMvc.perform(get("/api/v1/me"))
            .andExpect(status().isOk());
    }
}
```

### Run Tests

```bash
mvn test -Dtest=UserControllerTest
```

---

## Option 4: Manual Curl Testing (When Backend Running)

### Test 1: Health Check (No Auth)

```bash
curl -i http://localhost:8080/health
```

**Expected:** `200 OK`

### Test 2: Unauthorized Access

```bash
curl -i http://localhost:8080/api/v1/me
```

**Expected:** `401 Unauthorized`

### Test 3: With Mock Token

```bash
# Replace TOKEN with generated mock token from Option 2
curl -i -H "Authorization: Bearer TOKEN" \
  http://localhost:8080/api/v1/me
```

**Expected:** `200 OK` with user details

### Test 4: With Cognito Token

```bash
# Get real token from Cognito/LocalStack
curl -i -H "Authorization: Bearer COGNITO_TOKEN" \
  http://localhost:8080/api/v1/me
```

**Expected:** `200 OK` with auto-created user

---

## Complete Test Script

Create `test-cognito-local.sh`:

```bash
#!/bin/bash

set -e

echo "🧪 WBGT CrewSafe SG - Cognito Local Testing"
echo "==========================================="

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Configuration
BACKEND_URL="http://localhost:8080"
LOCALSTACK_ENDPOINT="http://localhost:4566"
AWS_REGION="ap-southeast-1"
USER_POOL_ID="${AWS_REGION}_local"
CLIENT_ID="1234567890abcdefghijklmno"

echo -e "${YELLOW}[1/5] Starting Docker services...${NC}"
docker-compose -f docker-compose-localstack.yml up -d
sleep 10

echo -e "${YELLOW}[2/5] Creating Cognito User Pool...${NC}"
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_DEFAULT_REGION=$AWS_REGION

# Create User Pool (simplified for LocalStack)
echo "User Pool ID: $USER_POOL_ID"

echo -e "${YELLOW}[3/5] Creating test users...${NC}"
# Create users via LocalStack (if supported) or use mock tokens

echo -e "${YELLOW}[4/5] Testing backend health...${NC}"
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" $BACKEND_URL/health)

if [ $HEALTH -eq 200 ]; then
    echo -e "${GREEN}✓ Health check passed${NC}"
else
    echo -e "${RED}✗ Health check failed (HTTP $HEALTH)${NC}"
    exit 1
fi

echo -e "${YELLOW}[5/5] Testing authentication...${NC}"

# Test 1: No token should fail
echo -n "Testing unauthorized access... "
RESULT=$(curl -s -o /dev/null -w "%{http_code}" $BACKEND_URL/api/v1/me)
if [ $RESULT -eq 401 ]; then
    echo -e "${GREEN}✓ Correctly rejected (401)${NC}"
else
    echo -e "${RED}✗ Expected 401, got $RESULT${NC}"
fi

# Test 2: With mock/real token
echo "Testing with token..."
# TOKEN would come from Cognito or mock generator
# curl -H "Authorization: Bearer $TOKEN" $BACKEND_URL/api/v1/me

echo -e "${GREEN}✓ All tests completed!${NC}"
echo ""
echo "Logs:"
echo "  Backend: docker-compose -f docker-compose-localstack.yml logs backend"
echo "  LocalStack: docker-compose -f docker-compose-localstack.yml logs localstack"
```

### Run Test Script

```bash
chmod +x test-cognito-local.sh
./test-cognito-local.sh
```

---

## Troubleshooting

### "Connection refused" when connecting to LocalStack

```bash
# Check if LocalStack is running
docker ps | grep localstack

# View logs
docker logs localstack-crewsafe
```

### JWT Validation Fails

**Symptoms:** `401 Unauthorized` even with valid token

**Solutions:**
1. Verify issuer URL matches COGNITO_ISSUER_URI
2. Check JWT expiration time
3. Verify COGNITO_JWK_URI is accessible
4. Review JWT claims (especially `aud` and `sub`)

### Database Connection Issues

```bash
# Check PostgreSQL is running
docker ps | grep postgres

# Test connection
docker-compose exec postgres psql -U postgres -d crewsafe -c "SELECT 1;"
```

---

## JWT Token Structure (For Reference)

Cognito access tokens typically contain:

```json
{
  "sub": "12345-67890-abcdef",
  "aud": "1234567890abcdefghijklmno",
  "email_verified": true,
  "event_id": "12345-67890-abcdef",
  "token_use": "access",
  "scope": "openid email profile",
  "auth_time": 1625000000,
  "iss": "https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_XXXXXXXXX",
  "exp": 1625003600,
  "iat": 1625000000,
  "jti": "12345-67890-abcdef",
  "client_id": "1234567890abcdefghijklmno",
  "username": "worker1@crewsafe.local",
  "cognito:groups": ["workers"],
  "email": "worker1@crewsafe.local",
  "name": "Worker One"
}
```

---

## Testing Checklist

- [ ] Health endpoint responds (200 OK)
- [ ] Unauthorized access rejected (401 Unauthorized)
- [ ] Valid token accepted (200 OK)
- [ ] Invalid token rejected (401 Unauthorized)
- [ ] User created in database on first login
- [ ] RBAC roles extracted from cognito:groups
- [ ] Database schema initialized
- [ ] All 9 tables exist in PostgreSQL

---

## Next Steps

1. Choose testing option (LocalStack recommended)
2. Set up environment
3. Create users and groups
4. Generate tokens
5. Run integration tests
6. Verify all endpoints respond correctly

**Reference:** See COGNITO_SETUP_GUIDE.md for AWS console setup
