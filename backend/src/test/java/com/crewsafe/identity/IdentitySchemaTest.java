package com.crewsafe.identity;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.SiteMembership;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.repository.SiteMembershipRepository;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;

import java.math.BigDecimal;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Proves the Flyway migration produced a schema the entities actually map onto, and that
 * the constraints protecting FR-03 are enforced by the database rather than by hopeful
 * application code.
 */
class IdentitySchemaTest extends AbstractIntegrationTest {

    @Autowired
    private AppUserRepository users;

    @Autowired
    private SiteRepository sites;

    @Autowired
    private SiteMembershipRepository memberships;

    private AppUser newUser(String username, Role role) {
        return users.save(new AppUser(username, "not-a-real-sub-" + UUID.randomUUID(), "Test " + username, role));
    }

    private Site newSite(String name) {
        return sites.save(new Site(name, new BigDecimal("1.352100"), new BigDecimal("103.819800")));
    }

    @Test
    void persistsAndReadsBackAUser() {
        AppUser saved = newUser("worker-a", Role.WORKER);

        AppUser found = users.findByUsername("worker-a").orElseThrow();

        assertThat(found.getId()).isEqualTo(saved.getId());
        assertThat(found.getRole()).isEqualTo(Role.WORKER);
        assertThat(found.isActive()).isTrue();
        assertThat(found.getCreatedAt()).isNotNull();
    }

    @Test
    void usernameIsUnique() {
        newUser("duplicate-user", Role.WORKER);

        assertThatThrownBy(() -> newUser("duplicate-user", Role.SUPERVISOR))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void membershipDrivesSiteAccessLookup() {
        AppUser user = newUser("worker-b", Role.WORKER);
        Site assigned = newSite("Assigned Site");
        Site other = newSite("Other Site");

        memberships.save(new SiteMembership(user.getId(), assigned.getId()));

        assertThat(memberships.existsByUserIdAndSiteId(user.getId(), assigned.getId())).isTrue();
        assertThat(memberships.existsByUserIdAndSiteId(user.getId(), other.getId())).isFalse();
        assertThat(memberships.findSiteIdsByUserId(user.getId())).containsExactly(assigned.getId());
    }

    @Test
    void sameUserCannotBeAddedToTheSameSiteTwice() {
        AppUser user = newUser("worker-c", Role.WORKER);
        Site site = newSite("Single Membership Site");

        memberships.save(new SiteMembership(user.getId(), site.getId()));

        assertThatThrownBy(() -> memberships.saveAndFlush(new SiteMembership(user.getId(), site.getId())))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void membershipRequiresAnExistingUser() {
        Site site = newSite("Orphan Check Site");

        assertThatThrownBy(() -> memberships.saveAndFlush(new SiteMembership(UUID.randomUUID(), site.getId())))
                .isInstanceOf(DataIntegrityViolationException.class);
    }
}
