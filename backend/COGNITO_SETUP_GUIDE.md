# Cognito Setup Guide for Local Development

This guide walks you through setting up Amazon Cognito for the WBGT CrewSafe SG backend.

## Step 1: Create AWS Cognito User Pool

1. Go to [AWS Cognito Console](https://console.aws.amazon.com/cognito)
2. Click **Create user pool**
3. Configure:
   - **Pool name:** `crewsafe-user-pool`
   - **Sign-in options:** Email
   - **MFA:** Optional (for MVP, can skip)
   - **Password policy:** Minimum 12 characters, require uppercase, lowercase, numbers, special chars

4. Click **Next**

5. **Configure sign-up experience:**
   - Standard attributes: email, name, phone_number
   - Custom attributes: (none for MVP)
   - Click **Next**

6. **Configure message delivery:**
   - Email provider: Send email with Cognito
   - Click **Next**

7. **Integrate your app:**
   - App type: Public client
   - App client name: `crewsafe-backend`
   - **Authentication flows:**
     - ✓ ADMIN_NO_SRP_AUTH (for testing)
     - ✓ ALLOW_REFRESH_TOKEN_AUTH
   - Click **Create app client**

8. Click **Create user pool**

## Step 2: Note Your Pool Details

After creation, go to **App integration > App clients and resources**

Copy these values:

```
User Pool ID:     ap-southeast-1_XXXXXXXXX
Client ID:        1234567890abcdefghijklmno
Client Secret:    (if generated)
```

## Step 3: Get Cognito Endpoints

1. Go to **App integration > Domain name** (or **Hosted UI**)
2. Note your domain (e.g., `crewsafe-123456.auth.ap-southeast-1.amazoncognito.com`)
3. Your JWKS endpoint is:
   ```
   https://cognito-idp.ap-southeast-1.amazonaws.com/{USER_POOL_ID}/.well-known/jwks.json
   ```

## Step 4: Create User Groups

1. Go to **User groups**
2. Create these groups:
   - `workers` - Field workers
   - `supervisors` - Crew supervisors
   - `safety-managers` - Safety managers
   - `administrators` - System admins

Each group can have IAM roles (optional for MVP).

## Step 5: Create Test Users

1. Go to **Users**
2. Click **Create user**

Create these test users:

### Worker
- Username: `worker1@crewsafe.local`
- Email: `worker1@crewsafe.local`
- Temporary password: `TempPassword123!`
- Add to group: `workers`

### Supervisor
- Username: `supervisor1@crewsafe.local`
- Email: `supervisor1@crewsafe.local`
- Temporary password: `TempPassword123!`
- Add to group: `supervisors`

### Safety Manager
- Username: `manager1@crewsafe.local`
- Email: `manager1@crewsafe.local`
- Temporary password: `TempPassword123!`
- Add to group: `safety-managers`

### Admin
- Username: `admin1@crewsafe.local`
- Email: `admin1@crewsafe.local`
- Temporary password: `TempPassword123!`
- Add to group: `administrators`

## Step 6: Configure Backend

Update `docker-compose.yml`:

```yaml
environment:
  COGNITO_ISSUER_URI: https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_XXXXXXXXX
  COGNITO_JWK_URI: https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_XXXXXXXXX/.well-known/jwks.json
```

Replace `ap-southeast-1_XXXXXXXXX` with your actual User Pool ID.

## Step 7: Test the Integration

### Get a Test Token

```bash
# Set your Cognito details
POOL_ID="ap-southeast-1_XXXXXXXXX"
CLIENT_ID="your-client-id"
USERNAME="worker1@crewsafe.local"
PASSWORD="YourNewPassword123!"  # After first login change from temporary

# Get token via AWS CLI
aws cognito-idp initiate-auth \
  --auth-flow ADMIN_NO_SRP_AUTH \
  --client-id $CLIENT_ID \
  --user-pool-id $POOL_ID \
  --auth-parameters USERNAME=$USERNAME,PASSWORD=$PASSWORD \
  --region ap-southeast-1
```

Response will include:
```json
{
  "AuthenticationResult": {
    "AccessToken": "eyJhbGciOiJIUzI1NiIs...",
    "IdToken": "eyJhbGciOiJIUzI1NiIs...",
    "RefreshToken": "..."
  }
}
```

### Test the Backend

```bash
# Start backend
docker-compose up --build

# In another terminal, get a token (see above)
# Then test the /me endpoint

curl -H "Authorization: Bearer {ACCESS_TOKEN}" \
  http://localhost:8080/api/v1/me
```

Expected response:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "worker1@crewsafe.local",
  "displayName": "Worker One"
}
```

## Step 8: CORS Configuration (If Needed)

If your frontend is on a different origin, add to **App client settings**:

1. **Allowed callback URLs:**
   - `http://localhost:3000/callback`
   - `http://localhost:8080/login/oauth2/code/cognito`

2. **Allowed sign-out URLs:**
   - `http://localhost:3000/logout`

## Testing Roles/Groups

The JWT token from Cognito includes:
```json
{
  "cognito:groups": ["workers"],
  "sub": "12345-67890-abcdef",
  "email": "worker1@crewsafe.local",
  ...
}
```

Your backend maps this to Spring Security authorities:
- `cognito:groups: ["workers"]` → `ROLE_WORKER`
- `cognito:groups: ["supervisors"]` → `ROLE_SUPERVISOR`

## Troubleshooting

### "Invalid issuer" error
- Check COGNITO_ISSUER_URI matches your pool region and ID
- Verify User Pool ID is correct (ap-southeast-1_XXXXXXXXX)

### Token validation fails
- Verify COGNITO_JWK_URI is reachable from your backend
- Check your internet connection to AWS

### User can't sign in
- Reset password: Go to Users > {username} > Set password
- Confirm email: Go to Users > {username} > Mark email as verified

### Group not appearing in token
- Go to User Groups > {group} > Add users to group
- User needs to sign out and back in to get new token

### "Invalid client id"
- Verify CLIENT_ID matches App client ID in Cognito console
- Check you're using the right region

## Next Steps

1. ✅ Start Docker: `docker-compose up --build`
2. ✅ Get test token using AWS CLI or Postman
3. ✅ Test `/api/v1/me` endpoint
4. ✅ Build shift management endpoints
5. ✅ Add weather ingestion
6. ✅ Implement policy engine

## Resources

- [AWS Cognito Documentation](https://docs.aws.amazon.com/cognito/)
- [Spring Security OAuth 2.0 Resource Server](https://spring.io/projects/spring-security-oauth2-resource-server)
- [JWT Token Structure](https://tools.ietf.org/html/rfc7519)
- [Cognito User Groups](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-identity-pools-user-groups.html)

## Quick Reference

```bash
# Start local backend
docker-compose up --build

# View logs
docker-compose logs -f backend

# Reset everything
docker-compose down -v
docker-compose up --build

# Access database
docker-compose exec postgres psql -U postgres -d crewsafe

# Check health
curl http://localhost:8080/health

# View API docs
open http://localhost:8080/swagger-ui.html
```

---

**Ready to test?**

1. Complete AWS Cognito setup above
2. Run `docker-compose up --build`
3. Get a test token
4. Call `/api/v1/me` with the token

Let me know if you hit any issues! 🚀
