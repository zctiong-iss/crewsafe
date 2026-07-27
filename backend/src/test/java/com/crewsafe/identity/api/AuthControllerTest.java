package com.crewsafe.identity.api;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.common.audit.AuditEventType;
import com.crewsafe.common.audit.AuditEventRepository;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.SiteMembership;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.repository.SiteMembershipRepository;
import com.crewsafe.identity.security.JwtProperties;
import com.crewsafe.identity.security.JwtService;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@AutoConfigureMockMvc
@TestPropertySource(properties = "app.rate-limit.login.capacity=100000")
class AuthControllerTest extends AbstractIntegrationTest {

    private static final String PASSWORD = "correct-password";

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private AppUserRepository users;
    @Autowired private SiteRepository sites;
    @Autowired private SiteMembershipRepository memberships;
    @Autowired private AuditEventRepository auditEvents;
    @Autowired private PasswordEncoder passwordEncoder;
    @Autowired private JwtService jwtService;

    private AppUser worker;
    private Site site;
    private String username;

    @BeforeEach
    void setUp() {
        // Unique username per test run: the Postgres container is shared across classes.
        username = "authtest-" + UUID.randomUUID();
        worker = users.save(new AppUser(username, passwordEncoder.encode(PASSWORD), "Auth Test Worker", Role.WORKER));
        site = sites.save(new Site("Auth Test Site " + UUID.randomUUID(),
                new BigDecimal("1.300000"), new BigDecimal("103.800000")));
        memberships.save(new SiteMembership(worker.getId(), site.getId()));
    }

    private String loginAndReadToken(String field) throws Exception {
        String body = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(username, PASSWORD)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(body).get(field).asText();
    }

    private String json(String user, String password) throws Exception {
        return objectMapper.writeValueAsString(new AuthDtos.LoginRequest(user, password));
    }

    // --- login ---

    @Test
    void loginWithValidCredentialsReturnsBothTokens() throws Exception {
        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(username, PASSWORD)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").isNotEmpty())
                .andExpect(jsonPath("$.refreshToken").isNotEmpty())
                .andExpect(jsonPath("$.tokenType").value("Bearer"))
                .andExpect(jsonPath("$.expiresInSeconds").value(900))
                .andExpect(header().doesNotExist("Set-Cookie"));
    }

    @Test
    void loginWithWrongPasswordReturnsGeneric401() throws Exception {
        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(username, "wrong-password")))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.message").value("Authentication failed"));
    }

    @Test
    void unknownUserAndWrongPasswordAreIndistinguishable() throws Exception {
        // No username enumeration: both failures must look identical to the caller.
        String unknownUser = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json("no-such-user-" + UUID.randomUUID(), PASSWORD)))
                .andExpect(status().isUnauthorized())
                .andReturn().getResponse().getContentAsString();

        String wrongPassword = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(username, "wrong-password")))
                .andExpect(status().isUnauthorized())
                .andReturn().getResponse().getContentAsString();

        assertThat(unknownUser).isEqualTo(wrongPassword);
    }

    @Test
    void loginResponseNeverContainsThePasswordHash() throws Exception {
        String body = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(username, PASSWORD)))
                .andReturn().getResponse().getContentAsString();

        assertThat(body).doesNotContain("$2a$").doesNotContain("passwordHash");
    }

    @Test
    void blankUsernameIsRejectedAsBadRequestNotUnauthorized() throws Exception {
        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json("", PASSWORD)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void loginFailureIsAudited() throws Exception {
        long before = auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.LOGIN_FAILURE).size();

        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(username, "wrong-password")))
                .andExpect(status().isUnauthorized());

        assertThat(auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.LOGIN_FAILURE))
                .hasSizeGreaterThan((int) before);
    }

    @Test
    void loginSuccessIsAudited() throws Exception {
        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(username, PASSWORD)))
                .andExpect(status().isOk());

        assertThat(auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.LOGIN_SUCCESS))
                .anyMatch(e -> worker.getId().equals(e.getActorId()));
    }

    // --- the access token works ---

    @Test
    void accessTokenAuthenticatesTheMeEndpoint() throws Exception {
        String accessToken = loginAndReadToken("accessToken");

        mockMvc.perform(get("/api/v1/me").header("Authorization", "Bearer " + accessToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value(username))
                .andExpect(jsonPath("$.role").value("WORKER"))
                .andExpect(jsonPath("$.displayName").value("Auth Test Worker"))
                .andExpect(jsonPath("$.siteIds[0]").value(site.getId().toString()));
    }

    @Test
    void meResponseNeverLeaksThePasswordHash() throws Exception {
        String accessToken = loginAndReadToken("accessToken");

        String body = mockMvc.perform(get("/api/v1/me").header("Authorization", "Bearer " + accessToken))
                .andReturn().getResponse().getContentAsString();

        assertThat(body).doesNotContain("$2a$").doesNotContain("passwordHash");
    }

    // --- refresh ---

    @Test
    void refreshTokenExchangesForANewWorkingAccessToken() throws Exception {
        String refreshToken = loginAndReadToken("refreshToken");

        String body = mockMvc.perform(post("/api/v1/auth/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"refreshToken\":\"" + refreshToken + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").isNotEmpty())
                .andExpect(jsonPath("$.refreshToken").isNotEmpty())
                .andReturn().getResponse().getContentAsString();

        JsonNode refreshed = objectMapper.readTree(body);
        mockMvc.perform(get("/api/v1/me")
                        .header("Authorization", "Bearer " + refreshed.get("accessToken").asText()))
                .andExpect(status().isOk());
    }

    /**
     * The single most important test in this class.
     */
    @Test
    void refreshTokenIsRejectedAsAnAccessTokenOnProtectedEndpoints() throws Exception {
        String refreshToken = loginAndReadToken("refreshToken");

        mockMvc.perform(get("/api/v1/me").header("Authorization", "Bearer " + refreshToken))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void accessTokenCannotBeUsedToRefresh() throws Exception {
        String accessToken = loginAndReadToken("accessToken");

        mockMvc.perform(post("/api/v1/auth/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"refreshToken\":\"" + accessToken + "\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void refreshWithAGarbageTokenReturns401() throws Exception {
        mockMvc.perform(post("/api/v1/auth/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"refreshToken\":\"not-a-token\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void deactivatedUserCannotUseAnExistingToken() throws Exception {
        String accessToken = loginAndReadToken("accessToken");

        AppUser stored = users.findById(worker.getId()).orElseThrow();
        stored.setStatus(com.crewsafe.identity.domain.UserStatus.INACTIVE);
        users.save(stored);

        // The token is still cryptographically valid. Account status is re-read from the
        // database on every request, so deactivation takes effect immediately rather than
        // whenever the token happens to expire.
        mockMvc.perform(get("/api/v1/me").header("Authorization", "Bearer " + accessToken))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void tokenSignedByAnotherKeyIsRejected() throws Exception {
        // Signed with a different key rather than character-substituted. An earlier
        // version of this test mutated the token with replace('a','b'), which silently
        // does nothing when a randomly generated token happens to contain no 'a' - and
        // then asserts that a perfectly valid token is rejected. Forge deliberately.
        JwtProperties attackerProperties = new JwtProperties();
        attackerProperties.setSecret("a-totally-different-secret-key-32-bytes");
        attackerProperties.setIssuer("crewsafe");
        String forged = new JwtService(attackerProperties).generateAccessToken(worker);

        mockMvc.perform(get("/api/v1/me").header("Authorization", "Bearer " + forged))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void tokenWithATamperedPayloadIsRejected() throws Exception {
        String valid = jwtService.generateAccessToken(worker);
        String[] parts = valid.split("\\.");
        // Keep the header and signature, swap in a different payload.
        String tampered = parts[0] + "." + java.util.Base64.getUrlEncoder().withoutPadding()
                .encodeToString(("{\"sub\":\"" + UUID.randomUUID() + "\",\"typ\":\"access\"}")
                        .getBytes(java.nio.charset.StandardCharsets.UTF_8))
                + "." + parts[2];

        mockMvc.perform(get("/api/v1/me").header("Authorization", "Bearer " + tampered))
                .andExpect(status().isUnauthorized());
    }
}
