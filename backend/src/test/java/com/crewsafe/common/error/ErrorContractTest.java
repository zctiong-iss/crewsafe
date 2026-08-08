package com.crewsafe.common.error;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.common.web.RequestIdFilter;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.SiteMembership;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.repository.SiteMembershipRepository;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.math.BigDecimal;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The error contract the web app codes against.
 *
 * <p>Every failure — whether Spring Security writes it before any controller runs, or a
 * controller throws — must produce the same JSON shape. A client that has to guess which
 * shape it got will end up rendering "undefined" to a user at the worst possible moment.
 *
 * @author Jemilin Beulah
 */
@AutoConfigureMockMvc
class ErrorContractTest extends AbstractIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private AppUserRepository users;
    @Autowired private SiteRepository sites;
    @Autowired private SiteMembershipRepository memberships;

    private AppUser user(Role role) {
        String username = "error-contract-" + UUID.randomUUID();
        createCognitoUser(username);
        return users.save(new AppUser(username, subFor(username), "Error Contract Test " + role, role));
    }

    private Site site() {
        return sites.save(new Site("Error Contract " + UUID.randomUUID(),
                new BigDecimal("1.300000"), new BigDecimal("103.800000")));
    }

    /** Written by the security chain, before any controller is reached. */
    @Test
    void unauthenticatedErrorHasTheStandardShape() throws Exception {
        mockMvc.perform(get("/api/v1/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("Unauthorized"))
                .andExpect(jsonPath("$.message").value("Authentication failed"))
                .andExpect(jsonPath("$.requestId").isNotEmpty());
    }

    /**
     * An unmapped URL under {@code /api} answers 401, not 404 — authentication is checked
     * before routing, so an anonymous caller cannot use 404-vs-401 to map which endpoints
     * exist. Asserted deliberately: it looks like a bug until you see why it is not.
     */
    @Test
    void unmappedUrlIsIndistinguishableFromAnUnauthenticatedOne() throws Exception {
        mockMvc.perform(get("/api/v1/no-such-endpoint"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("Unauthorized"))
                .andExpect(jsonPath("$.requestId").isNotEmpty());
    }

    /**
     * A malformed UUID is the caller's mistake, not a server failure. Before
     * MethodArgumentTypeMismatchException was handled explicitly this returned 500, which
     * would have had the UI showing "something went wrong on our end" for a bad link.
     */
    @Test
    void malformedPathVariableIs400NotServerError() throws Exception {
        String token = mintAccessToken(user(Role.WORKER).getUsername());

        mockMvc.perform(get("/api/v1/sites/not-a-uuid").header("Authorization", "Bearer " + token))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Bad Request"))
                .andExpect(jsonPath("$.requestId").isNotEmpty());
    }

    @Test
    void everyResponseCarriesARequestIdHeader() throws Exception {
        mockMvc.perform(get("/api/v1/me"))
                .andExpect(header().exists(RequestIdFilter.HEADER));
    }

    /**
     * The id in the body is the id in the header. They are the same request; if they
     * disagreed, quoting one would find nothing in the logs.
     */
    @Test
    void theRequestIdInTheBodyMatchesTheHeader() throws Exception {
        MvcResult result = mockMvc.perform(get("/api/v1/me"))
                .andExpect(status().isUnauthorized())
                .andReturn();

        String header = result.getResponse().getHeader(RequestIdFilter.HEADER);
        String body = result.getResponse().getContentAsString();

        assertThat(header).isNotBlank();
        assertThat(body).contains(header);
    }

    /** Two requests must not share an id, or the id identifies nothing. */
    @Test
    void everyRequestGetsADistinctId() throws Exception {
        String first = mockMvc.perform(get("/api/v1/me"))
                .andReturn().getResponse().getHeader(RequestIdFilter.HEADER);
        String second = mockMvc.perform(get("/api/v1/me"))
                .andReturn().getResponse().getHeader(RequestIdFilter.HEADER);

        assertThat(first).isNotEqualTo(second);
    }

    /**
     * A caller must not be able to choose its own request id: the value is written into our
     * logs, so accepting it would let anyone forge log entries.
     */
    @Test
    void anInboundRequestIdIsIgnored() throws Exception {
        String forged = "forged-" + UUID.randomUUID();

        String issued = mockMvc.perform(get("/api/v1/me").header(RequestIdFilter.HEADER, forged))
                .andReturn().getResponse().getHeader(RequestIdFilter.HEADER);

        assertThat(issued).isNotEqualTo(forged);
    }

    /**
     * SCRUM-263: every documented 404 must carry the same {@link ErrorResponse} body as
     * every other error, not an empty one. Hits a real domain endpoint (rather than
     * testing {@link GlobalExceptionHandler} in isolation) so this fails if any
     * controller ever regresses back to building {@code ResponseEntity.notFound()}
     * directly, which bypasses the handler entirely.
     */
    @Test
    void aDomainNotFoundHasTheStandardShape() throws Exception {
        AppUser worker = user(Role.WORKER);
        Site site = site();
        memberships.save(new SiteMembership(worker.getId(), site.getId()));
        String token = mintAccessToken(worker.getUsername());

        mockMvc.perform(get("/api/v1/sites/" + site.getId() + "/shifts/" + UUID.randomUUID())
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("Not Found"))
                .andExpect(jsonPath("$.message").value("No such resource"))
                .andExpect(jsonPath("$.requestId").isNotEmpty());
    }

    /** No error body may carry a stack trace, exception name or SQL fragment. */
    @Test
    void errorBodiesNeverLeakInternals() throws Exception {
        String body = mockMvc.perform(get("/api/v1/me"))
                .andReturn().getResponse().getContentAsString();

        assertThat(body)
                .doesNotContain("Exception")
                .doesNotContain("org.springframework")
                .doesNotContain("com.crewsafe")
                .doesNotContain("select ");
    }
}
