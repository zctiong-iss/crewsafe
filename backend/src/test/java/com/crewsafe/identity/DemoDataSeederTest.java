package com.crewsafe.identity;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.repository.SiteMembershipRepository;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The seeder is a security-relevant component - it creates the only accounts that exist -
 * so its behaviour is verified rather than assumed.
 */
@ActiveProfiles("local")
@TestPropertySource(properties = "app.seed.password=seed-password-for-tests")
class DemoDataSeederTest extends AbstractIntegrationTest {

    @Autowired
    private AppUserRepository users;

    @Autowired
    private SiteRepository sites;

    @Autowired
    private SiteMembershipRepository memberships;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private DemoDataSeeder seeder;

    @Test
    void seedsOneAccountPerRole() {
        assertThat(users.findByUsername("supervisor1")).isPresent();
        assertThat(users.findByUsername("worker1")).isPresent();
        assertThat(users.findByUsername("manager1")).isPresent();
        assertThat(users.findByUsername("admin1")).isPresent();

        assertThat(users.findByUsername("worker1").orElseThrow().getRole()).isEqualTo(Role.WORKER);
        assertThat(users.findByUsername("manager1").orElseThrow().getRole()).isEqualTo(Role.SAFETY_MANAGER);
        assertThat(users.findByUsername("admin1").orElseThrow().getRole()).isEqualTo(Role.ADMIN);
    }

    @Test
    void storesTheSeedPasswordAsABcryptHashNotPlaintext() {
        AppUser supervisor = users.findByUsername("supervisor1").orElseThrow();

        assertThat(supervisor.getPasswordHash()).isNotEqualTo("seed-password-for-tests");
        assertThat(supervisor.getPasswordHash()).startsWith("$2a$");
        assertThat(passwordEncoder.matches("seed-password-for-tests", supervisor.getPasswordHash())).isTrue();
    }

    @Test
    void assignsSupervisorsToDifferentSites() {
        Site bishan = sites.findByName("Bishan Park Landscaping").orElseThrow();
        Site campus = sites.findByName("NUS Campus Maintenance").orElseThrow();

        AppUser supervisor1 = users.findByUsername("supervisor1").orElseThrow();
        AppUser supervisor2 = users.findByUsername("supervisor2").orElseThrow();

        assertThat(memberships.existsByUserIdAndSiteId(supervisor1.getId(), bishan.getId())).isTrue();
        assertThat(memberships.existsByUserIdAndSiteId(supervisor2.getId(), campus.getId())).isTrue();

        // This pair is what makes the FR-03 negative test meaningful: supervisor2 has a
        // valid account and a real role, but no business at the Bishan site.
        assertThat(memberships.existsByUserIdAndSiteId(supervisor2.getId(), bishan.getId())).isFalse();
    }

    @Test
    void safetyManagerCoversBothSites() {
        AppUser manager = users.findByUsername("manager1").orElseThrow();

        assertThat(memberships.findSiteIdsByUserId(manager.getId())).hasSize(2);
    }

    @Test
    void seedingIsIdempotent() {
        long usersBefore = users.count();
        long sitesBefore = sites.count();

        // Simulates a second application start against an already-seeded database.
        // Without the existsByUsername guard this would throw on the unique constraint.
        seeder.run(null);

        assertThat(users.count()).isEqualTo(usersBefore);
        assertThat(sites.count()).isEqualTo(sitesBefore);
    }
}
