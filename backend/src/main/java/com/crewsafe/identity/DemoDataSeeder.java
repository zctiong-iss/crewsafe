package com.crewsafe.identity;

import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.SiteMembership;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.repository.SiteMembershipRepository;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.List;

/**
 * Seeds synthetic demo accounts, sites and memberships.
 *
 * All identities are fictional — the project uses no real worker data.
 *
 * Restricted to the local and staging profiles so it can never run in a production-demo
 * deployment. The password comes from the SEED_USER_PASSWORD environment variable and is
 * hashed before storage; nothing is hardcoded and no hash is committed. If the variable is
 * absent the seeder does nothing rather than inventing a default credential.
 */
@Component
@Profile({"local", "staging"})
@RequiredArgsConstructor
@Slf4j
public class DemoDataSeeder implements ApplicationRunner {

    private final AppUserRepository users;
    private final SiteRepository sites;
    private final SiteMembershipRepository memberships;
    private final PasswordEncoder passwordEncoder;

    @Value("${app.seed.password:}")
    private String seedPassword;

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (seedPassword == null || seedPassword.isBlank()) {
            log.warn("SEED_USER_PASSWORD not set - skipping demo data seeding. "
                    + "No demo accounts will exist.");
            return;
        }

        if (users.existsByUsername("supervisor1")) {
            log.info("Demo data already present - skipping seeding.");
            return;
        }

        // Two sites. The second exists so that "user cannot reach a site they are not
        // assigned to" is testable — with only one site the rule is unfalsifiable.
        Site bishan = sites.save(new Site("Bishan Park Landscaping",
                new BigDecimal("1.362200"), new BigDecimal("103.845500")));
        Site campus = sites.save(new Site("NUS Campus Maintenance",
                new BigDecimal("1.296600"), new BigDecimal("103.776400")));

        String hash = passwordEncoder.encode(seedPassword);

        AppUser supervisor1 = users.save(new AppUser("supervisor1", hash, "Aisyah (Supervisor)", Role.SUPERVISOR));
        AppUser supervisor2 = users.save(new AppUser("supervisor2", hash, "Rajesh (Supervisor)", Role.SUPERVISOR));
        AppUser worker1 = users.save(new AppUser("worker1", hash, "Meng Hui (Worker)", Role.WORKER));
        AppUser worker2 = users.save(new AppUser("worker2", hash, "Siti (Worker)", Role.WORKER));
        AppUser worker3 = users.save(new AppUser("worker3", hash, "Kumar (Worker)", Role.WORKER));
        AppUser manager1 = users.save(new AppUser("manager1", hash, "Wei Ling (Safety Manager)", Role.SAFETY_MANAGER));
        users.save(new AppUser("admin1", hash, "System Administrator", Role.ADMIN));

        // Bishan crew: one supervisor, three workers.
        memberships.saveAll(List.of(
                new SiteMembership(supervisor1.getId(), bishan.getId()),
                new SiteMembership(worker1.getId(), bishan.getId()),
                new SiteMembership(worker2.getId(), bishan.getId()),
                new SiteMembership(worker3.getId(), bishan.getId())
        ));

        // Campus crew: a different supervisor, deliberately with no Bishan access.
        memberships.save(new SiteMembership(supervisor2.getId(), campus.getId()));

        // The safety manager oversees both sites.
        memberships.saveAll(List.of(
                new SiteMembership(manager1.getId(), bishan.getId()),
                new SiteMembership(manager1.getId(), campus.getId())
        ));

        log.info("Seeded 7 demo users across 2 sites ({}, {}).", bishan.getName(), campus.getName());
    }
}
