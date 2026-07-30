package com.crewsafe.identity;

import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.SiteMembership;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.repository.SiteMembershipRepository;
import com.crewsafe.identity.security.CognitoProperties;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

/**
 * Seeds synthetic demo accounts, sites and memberships.
 *
 * All identities are fictional — the project uses no real worker data.
 *
 * Restricted to the local and staging profiles so it can never run in a production-demo
 * deployment. Accounts are administered (FR-01), so this class does not create them — it
 * consumes reviewed, non-sensitive mappings from the shared Cognito configuration and
 * never calls AWS or handles credentials.
 *
 * @author Jemilin Beulah
 */
@Component
@Profile({"local", "staging"})
@RequiredArgsConstructor
@Slf4j
public class DemoDataSeeder implements ApplicationRunner {

    private final AppUserRepository users;
    private final SiteRepository sites;
    private final SiteMembershipRepository memberships;
    private final CognitoProperties cognitoProperties;
    private final ObjectMapper objectMapper;

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (users.existsByUsername("supervisor1")) {
            log.info("Demo data already present - skipping seeding.");
            return;
        }

        List<DemoUserMapping> mappings = parseAndValidateMappings(
                objectMapper, cognitoProperties.getDemoUsersJson());

        // Two sites. The second exists so that "user cannot reach a site they are not
        // assigned to" is testable — with only one site the rule is unfalsifiable.
        Site bishan = sites.save(new Site("Bishan Park Landscaping",
                new BigDecimal("1.362200"), new BigDecimal("103.845500")));
        Site campus = sites.save(new Site("NUS Campus Maintenance",
                new BigDecimal("1.296600"), new BigDecimal("103.776400")));

        Map<String, Site> siteByCode = Map.of("bishan", bishan, "campus", campus);
        Map<String, AppUser> saved = mappings.stream().collect(java.util.stream.Collectors.toMap(
                DemoUserMapping::username,
                mapping -> users.save(new AppUser(mapping.username(), mapping.cognitoSub(),
                        mapping.displayName(), mapping.role()))));
        for (DemoUserMapping mapping : mappings) {
            for (String siteCode : mapping.siteCodes()) {
                memberships.save(new SiteMembership(saved.get(mapping.username()).getId(),
                        siteByCode.get(siteCode).getId()));
            }
        }

        log.info("Seeded {} synthetic demo users across 2 sites ({}, {}).",
                mappings.size(), bishan.getName(), campus.getName());
    }

    static List<DemoUserMapping> parseAndValidateMappings(ObjectMapper mapper, String json) {
        final List<DemoUserMapping> mappings;
        try {
            mappings = mapper.readValue(json, new TypeReference<>() {});
        } catch (Exception exception) {
            throw new IllegalArgumentException("Mapping JSON is malformed.", exception);
        }
        if (mappings == null || mappings.isEmpty() || mappings.stream().anyMatch(java.util.Objects::isNull)
                || mappings.stream().map(DemoUserMapping::username).anyMatch(java.util.Objects::isNull)
                || mappings.stream().map(DemoUserMapping::username).distinct().count() != mappings.size()
                || mappings.stream().map(DemoUserMapping::cognitoSub).anyMatch(java.util.Objects::isNull)
                || mappings.stream().map(DemoUserMapping::cognitoSub).distinct().count() != mappings.size()) {
            throw new IllegalArgumentException("Mappings must contain unique usernames and Cognito subjects.");
        }
        for (DemoUserMapping mapping : mappings) {
            if (!mapping.username().matches("^[a-z0-9]+([._-][a-z0-9]+)*$")
                    || mapping.cognitoSub().isBlank() || mapping.cognitoSub().contains("@")
                    || mapping.displayName() == null || mapping.displayName().isBlank()
                    || mapping.displayName().length() > 100 || mapping.role() == null
                    || mapping.siteCodes() == null
                    || mapping.siteCodes().stream().anyMatch(java.util.Objects::isNull)
                    || mapping.siteCodes().stream().distinct().count() != mapping.siteCodes().size()
                    || mapping.identityKind() == null
                    || !List.of("developer", "synthetic-test").contains(mapping.identityKind())
                    || mapping.siteCodes().stream().anyMatch(code -> !List.of("bishan", "campus").contains(code))) {
                throw new IllegalArgumentException("Mapping contains an unsafe subject, identity kind, or site code.");
            }
        }
        return List.copyOf(mappings);
    }

    record DemoUserMapping(String username, String cognitoSub, String displayName,
                           Role role, List<String> siteCodes, String identityKind) {}
}
