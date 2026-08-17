package com.crewsafe;

import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.utility.MountableFile;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.cognitoidentityprovider.CognitoIdentityProviderClient;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminCreateUserRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminGetUserRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminSetUserPasswordRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AttributeType;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AuthFlowType;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AuthenticationResultType;
import software.amazon.awssdk.services.cognitoidentityprovider.model.CreateUserPoolClientRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.CreateUserPoolRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.ExplicitAuthFlowsType;
import software.amazon.awssdk.services.cognitoidentityprovider.model.InitiateAuthRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.InitiateAuthResponse;
import software.amazon.awssdk.services.cognitoidentityprovider.model.MessageActionType;

import java.net.URI;
import java.util.List;
import java.util.Map;

/**
 * Base class for tests that need a database and a Cognito user pool.
 *
 * <p>Postgres runs against the real image (Testcontainers) rather than H2, for the reasons
 * already documented below. Cognito runs against {@code cognito-local}
 * (jagregory/cognito-local) rather than a hand-rolled JWKS fake, for the same reason: it is
 * the real Cognito Identity Provider HTTP API, so it signs genuine RS256 tokens and serves a
 * genuine JWKS - the resource server, the converter and {@code @PreAuthorize} chain are all
 * exercised for real. Only the pool itself is fake.
 *
 * <p>Both containers use the singleton pattern — started once in a static initialiser and
 * reused by every subclass for the lifetime of the JVM, rather than restarted per test class.
 *
 * @author Jemilin Beulah
 */
// @Import, not relying on @SpringBootTest's nested-@TestConfiguration auto-detection: that
// detection only reaches nested classes declared directly on the class actually annotated
// @SpringBootTest (or its enclosing nesting), not ones inherited from this superclass via
// extends -- without this, CognitoAdminTestConfig below silently never registers, and
// CognitoUserProvisioningService gets the production, real-AWS-pointed client instead.
@SpringBootTest
@Import(AbstractIntegrationTest.CognitoAdminTestConfig.class)
public abstract class AbstractIntegrationTest {

    static final PostgreSQLContainer<?> POSTGRES;
    static final GenericContainer<?> COGNITO_LOCAL;
    protected static final CognitoIdentityProviderClient COGNITO;

    protected static final String POOL_ID;
    protected static final String CLIENT_ID;
    protected static final String ISSUER_URI;
    protected static final String JWK_SET_URI;
    protected static final String ENDPOINT;

    /**
     * A second, entirely separate user pool in the same emulator, used to test the issuer
     * check. cognito-local signs every pool with one hardcoded keypair, so a token minted
     * here carries a different {@code iss} but a signature that verifies against the JWKS of
     * {@link #POOL_ID} - which is precisely what makes it a clean isolated test of
     * {@code JwtIssuerValidator} and nothing else. Its client id is registered in
     * {@code app.cognito.client-ids} below so that the client check passes too.
     */
    protected static final String OTHER_POOL_ID;
    protected static final String OTHER_POOL_CLIENT_ID;

    /** Every username {@code DemoDataSeeder} expects to already exist in the pool.
     * admin1 is email-shaped (@synthetic.crewsafe.invalid) — the live shared pool requires
     * an email-shaped username (username_attributes=["email"]), so the demo admin identity
     * matches that shape everywhere rather than only where it's actually enforced. */
    protected static final List<String> DEMO_USERNAMES = List.of("supervisor1", "supervisor2",
            "worker1", "worker2", "worker3", "manager1", "admin1@synthetic.crewsafe.invalid");

    protected static final String TEST_PASSWORD = "Test-Password-2026!";

    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:16");
        POSTGRES.start();

        // Pinned by digest for the same reason Postgres is pinned to a version: this
        // container is the whole authentication test surface, and an upstream push to
        // :latest must not be able to change token shape or break CI silently.
        //
        // Pinned to the multi-arch manifest list digest, not a single platform's manifest
        // digest - CI runners are amd64 while local development here is arm64, and a
        // single-platform digest only resolves on the architecture it was captured from
        // (pulling it elsewhere fails outright with "exec format error").
        COGNITO_LOCAL = new GenericContainer<>("jagregory/cognito-local@sha256:"
                + "a5ad30d01da5016a38535a717f6e1642d1b37f886a7b17e90b67f6e5ad134831")
                .withExposedPorts(9229)
                .withCopyToContainer(MountableFile.forClasspathResource("cognito-local-config.json"),
                        "/app/.cognito/config.json")
                .waitingFor(Wait.forLogMessage(".*Cognito Local running.*\\n", 1));
        COGNITO_LOCAL.start();

        ENDPOINT = "http://" + COGNITO_LOCAL.getHost() + ":" + COGNITO_LOCAL.getMappedPort(9229);

        COGNITO = CognitoIdentityProviderClient.builder()
                .region(Region.US_EAST_1)
                .endpointOverride(URI.create(ENDPOINT))
                // cognito-local accepts any credentials; it never checks the signature.
                .credentialsProvider(StaticCredentialsProvider.create(
                        AwsBasicCredentials.create("test", "test")))
                .build();

        POOL_ID = COGNITO.createUserPool(CreateUserPoolRequest.builder()
                .poolName("crewsafe-test")
                .build()).userPool().id();

        CLIENT_ID = COGNITO.createUserPoolClient(CreateUserPoolClientRequest.builder()
                .userPoolId(POOL_ID)
                .clientName("test-client")
                .explicitAuthFlows(ExplicitAuthFlowsType.ALLOW_USER_PASSWORD_AUTH,
                        ExplicitAuthFlowsType.ALLOW_REFRESH_TOKEN_AUTH)
                .build()).userPoolClient().clientId();

        // Fixed and independent of where the emulator actually is - see CognitoProperties.
        ISSUER_URI = "http://cognito-local/" + POOL_ID;
        JWK_SET_URI = ENDPOINT + "/" + POOL_ID + "/.well-known/jwks.json";

        OTHER_POOL_ID = COGNITO.createUserPool(CreateUserPoolRequest.builder()
                .poolName("not-crewsafe")
                .build()).userPool().id();

        OTHER_POOL_CLIENT_ID = COGNITO.createUserPoolClient(CreateUserPoolClientRequest.builder()
                .userPoolId(OTHER_POOL_ID)
                .clientName("not-crewsafe-client")
                .explicitAuthFlows(ExplicitAuthFlowsType.ALLOW_USER_PASSWORD_AUTH,
                        ExplicitAuthFlowsType.ALLOW_REFRESH_TOKEN_AUTH)
                .build()).userPoolClient().clientId();

        DEMO_USERNAMES.forEach(AbstractIntegrationTest::createCognitoUser);
    }

    @DynamicPropertySource
    static void testProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);

        // Every distinct test context Spring caches keeps its own Hikari pool open against the
        // one shared Postgres container for the whole run, and any test class that overrides a
        // bean (@MockitoBean, @TestPropertySource) is a distinct context. At Hikari's default of
        // ten connections each, adding a test class eventually tips the container past its
        // max_connections and the next context to start fails with "sorry, too many clients
        // already" — in a class that has nothing to do with whatever was added. Integration
        // tests here run one request at a time, so a small pool costs nothing and makes the
        // suite's connection ceiling a property of the container rather than of how many test
        // classes happen to exist (SCRUM-289).
        registry.add("spring.datasource.hikari.maximum-pool-size", () -> 4);
        // Health monitoring starts immediately. Keep the shared integration context
        // deterministic and offline so tests never call the public NEA service.
        registry.add("app.weather.data.mode", () -> "fixture");

        registry.add("app.cognito.issuer-uri", () -> ISSUER_URI);
        registry.add("app.cognito.jwk-set-uri", () -> JWK_SET_URI);
        // The other pool's client is trusted on purpose: it removes the client_id check from
        // the picture so that a token from that pool is rejected by the issuer check alone.
        registry.add("app.cognito.client-ids", () -> CLIENT_ID + "," + OTHER_POOL_CLIENT_ID);
        registry.add("app.cognito.demo-users-json", AbstractIntegrationTest::demoUsersJson);

        // Enabled against the same emulator pool everything else in this class already talks
        // to (see CognitoAdminTestConfig below, which points the CognitoIdentityProviderClient
        // bean at it) — real AdminCreateUser calls, no real AWS involved.
        registry.add("app.cognito-admin.enabled", () -> "true");
        registry.add("app.cognito-admin.user-pool-id", () -> POOL_ID);

        // Note: do NOT set anything here that a subclass's @TestPropertySource might need
        // to override. @DynamicPropertySource outranks a subclass's @TestPropertySource, so
        // a value set here cannot be overridden by a test that needs a different one.
    }

    private static String demoUsersJson() {
        return """
                [
                  {"username":"supervisor1","cognitoSub":"%s","displayName":"Aisyah (Supervisor)","role":"SUPERVISOR","siteCodes":["bishan"],"identityKind":"developer","desiredStatus":"preserve"},
                  {"username":"supervisor2","cognitoSub":"%s","displayName":"Rajesh (Supervisor)","role":"SUPERVISOR","siteCodes":["campus"],"identityKind":"developer","desiredStatus":"preserve"},
                  {"username":"worker1","cognitoSub":"%s","displayName":"Meng Hui (Worker)","role":"WORKER","siteCodes":["bishan"],"identityKind":"developer","desiredStatus":"preserve"},
                  {"username":"worker2","cognitoSub":"%s","displayName":"Siti (Worker)","role":"WORKER","siteCodes":["bishan"],"identityKind":"developer","desiredStatus":"preserve"},
                  {"username":"worker3","cognitoSub":"%s","displayName":"Kumar (Worker)","role":"WORKER","siteCodes":["bishan"],"identityKind":"developer","desiredStatus":"preserve"},
                  {"username":"manager1","cognitoSub":"%s","displayName":"Wei Ling (Safety Manager)","role":"SAFETY_MANAGER","siteCodes":["bishan","campus"],"identityKind":"developer","desiredStatus":"preserve"},
                  {"username":"admin1@synthetic.crewsafe.invalid","cognitoSub":"%s","displayName":"System Administrator","role":"ADMIN","siteCodes":[],"identityKind":"developer","desiredStatus":"preserve"}
                ]
                """.formatted(
                subFor("supervisor1"), subFor("supervisor2"), subFor("worker1"),
                subFor("worker2"), subFor("worker3"), subFor("manager1"),
                subFor("admin1@synthetic.crewsafe.invalid"));
    }

    /** Creates a Cognito user with a permanent password, ready for {@link #mintAccessToken}. */
    protected static void createCognitoUser(String username) {
        createCognitoUser(POOL_ID, username);
    }

    /** As {@link #createCognitoUser(String)}, but in a specific pool. */
    protected static void createCognitoUser(String poolId, String username) {
        COGNITO.adminCreateUser(AdminCreateUserRequest.builder()
                .userPoolId(poolId)
                .username(username)
                .messageAction(MessageActionType.SUPPRESS)
                .build());
        COGNITO.adminSetUserPassword(AdminSetUserPasswordRequest.builder()
                .userPoolId(poolId)
                .username(username)
                .password(TEST_PASSWORD)
                .permanent(true)
                .build());
    }

    /**
     * Creates an additional app client in the same pool, not included in
     * {@code app.cognito.client-ids} - used to prove a token from a client we do not
     * recognise is rejected, even though it is otherwise perfectly valid.
     */
    protected static String createUntrustedAppClient(String name) {
        return COGNITO.createUserPoolClient(CreateUserPoolClientRequest.builder()
                .userPoolId(POOL_ID)
                .clientName(name)
                .explicitAuthFlows(ExplicitAuthFlowsType.ALLOW_USER_PASSWORD_AUTH,
                        ExplicitAuthFlowsType.ALLOW_REFRESH_TOKEN_AUTH)
                .build()).userPoolClient().clientId();
    }

    /** The Cognito-assigned {@code sub} for a user created with {@link #createCognitoUser}. */
    protected static String subFor(String username) {
        return subFor(POOL_ID, username);
    }

    /** As {@link #subFor(String)}, but for a user in a specific pool. */
    protected static String subFor(String poolId, String username) {
        return COGNITO.adminGetUser(AdminGetUserRequest.builder()
                        .userPoolId(poolId)
                        .username(username)
                        .build())
                .userAttributes().stream()
                .filter(attribute -> "sub".equals(attribute.name()))
                .findFirst()
                .map(AttributeType::value)
                .orElseThrow();
    }

    /**
     * Mints a real access token the same way a real login would - RS256, signed by
     * cognito-local's own key, carrying {@code token_use}, {@code client_id} and {@code sub}
     * exactly as production Cognito would shape them.
     */
    protected static String mintAccessToken(String username) {
        return initiateAuth(CLIENT_ID, username).accessToken();
    }

    /** As {@link #mintAccessToken}, but returns the ID token instead of the access token. */
    protected static String mintIdToken(String username) {
        return initiateAuth(CLIENT_ID, username).idToken();
    }

    /** Mints an access token from a specific (possibly untrusted) app client. */
    protected static String mintAccessToken(String clientId, String username) {
        return initiateAuth(clientId, username).accessToken();
    }

    private static AuthenticationResultType initiateAuth(String clientId, String username) {
        InitiateAuthResponse response = COGNITO.initiateAuth(InitiateAuthRequest.builder()
                .clientId(clientId)
                .authFlow(AuthFlowType.USER_PASSWORD_AUTH)
                .authParameters(Map.of("USERNAME", username, "PASSWORD", TEST_PASSWORD))
                .build());
        return response.authenticationResult();
    }

    /**
     * {@code CognitoAdminClientConfiguration}'s production bean points at real AWS
     * (ap-southeast-1, the task role's ambient credentials) — pointed here instead at the
     * same {@code cognito-local} emulator every other admin call in this class already
     * uses, via the same static {@link #COGNITO} client, so
     * {@code CognitoUserProvisioningService} gets real integration coverage with no real
     * AWS calls in CI.
     */
    @TestConfiguration
    static class CognitoAdminTestConfig {

        @Bean
        @Primary
        CognitoIdentityProviderClient testCognitoIdentityProviderClient() {
            return COGNITO;
        }
    }
}
