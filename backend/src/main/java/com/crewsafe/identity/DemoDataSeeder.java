package com.crewsafe.identity;

import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.SiteMembership;
import com.crewsafe.identity.domain.UserStatus;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.repository.SiteMembershipRepository;
import com.crewsafe.identity.security.CognitoProperties;
import com.crewsafe.policy.domain.MomHeatPolicyDefaults;
import com.crewsafe.policy.domain.PolicyVersionStatus;
import com.crewsafe.policy.repository.PolicyVersionRepository;
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
import java.time.Clock;
import java.time.LocalDate;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Reconciles reviewed local/staging application accounts, sites and memberships.
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
    private final PolicyVersionRepository policyVersions;
    private final CognitoProperties cognitoProperties;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        List<DemoUserMapping> mappings = parseAndValidateMappings(
                objectMapper, cognitoProperties.getDemoUsersJson());

        // Two sites. The second exists so that "user cannot reach a site they are not
        // assigned to" is testable — with only one site the rule is unfalsifiable.
        Site bishan = findOrCreateSite("Bishan Park Landscaping",
                new BigDecimal("1.362200"), new BigDecimal("103.845500"));
        Site campus = findOrCreateSite("NUS Campus Maintenance",
                new BigDecimal("1.296600"), new BigDecimal("103.776400"));

        Map<String, Site> siteByCode = Map.of("bishan", bishan, "campus", campus);
        for (DemoUserMapping mapping : mappings) {
            AppUser user = reconcileIdentity(mapping);
            reconcileMemberships(user, mapping.siteCodes(), siteByCode);
        }

        log.info("demo_data_reconciled users={} sites=2", mappings.size());
    }

    /**
     * Creates the site if missing, and guarantees it has an ACTIVE heat policy either way.
     *
     * <p>The policy half is not cosmetic seeding (SCRUM-432). Without an ACTIVE
     * {@code policy_version}, {@code PolicyEngineService} throws, the draft endpoint answers 409,
     * and the site produces no recommendations, no mandatory rest and no hydration controls at
     * all — the heat-safety feature is simply inert. V17 backfills the sites that exist when it
     * runs; this covers the ones created afterwards, which is why the default belongs here and
     * not only in a migration.
     *
     * <p>Applied on the existing-site path too, not just on creation: a database migrated before
     * V17, or one whose site was made some other way, would otherwise stay inert forever.
     */
    private Site findOrCreateSite(String name, BigDecimal latitude, BigDecimal longitude) {
        Site site = sites.findByName(name)
                .orElseGet(() -> sites.save(new Site(name, latitude, longitude)));
        ensureActivePolicy(site);
        return site;
    }

    /**
     * Never overwrites a configured policy — a site that already has an ACTIVE version keeps it,
     * whatever its thresholds. {@code uq_policy_version_active_per_site} (V12) would reject a
     * second ACTIVE row anyway; checking first makes this a no-op rather than a startup crash.
     */
    private void ensureActivePolicy(Site site) {
        if (policyVersions.findBySiteIdAndStatus(site.getId(), PolicyVersionStatus.ACTIVE).isPresent()) {
            return;
        }
        policyVersions.save(MomHeatPolicyDefaults.activeVersionFor(site.getId(), LocalDate.now(clock)));
        log.info("demo_data_seeded_default_policy site_id={} version={}",
                site.getId(), MomHeatPolicyDefaults.VERSION_LABEL);
    }

    private AppUser reconcileIdentity(DemoUserMapping mapping) {
        Optional<AppUser> byUsername = users.findByUsername(mapping.username());
        Optional<AppUser> bySubject = users.findByCognitoSub(mapping.cognitoSub());

        if (byUsername.isEmpty() && bySubject.isEmpty()) {
            AppUser created = new AppUser(mapping.username(), mapping.cognitoSub(),
                    mapping.displayName(), mapping.role());
            created.setStatus(initialStatusFor(mapping));
            return users.save(created);
        }

        if (byUsername.isEmpty() || bySubject.isEmpty()
                || !byUsername.orElseThrow().getId().equals(bySubject.orElseThrow().getId())) {
            throw new IllegalStateException(
                    "Application-user mapping conflicts with an existing immutable Cognito subject.");
        }

        AppUser existing = byUsername.orElseThrow();
        existing.setDisplayName(mapping.displayName());
        existing.setRole(mapping.role());
        if (!"preserve".equals(mapping.desiredStatus())) {
            existing.setStatus(statusForSynthetic(mapping));
        }
        return existing;
    }

    private UserStatus initialStatusFor(DemoUserMapping mapping) {
        return "disabled".equals(mapping.desiredStatus())
                ? UserStatus.INACTIVE
                : UserStatus.ACTIVE;
    }

    private UserStatus statusForSynthetic(DemoUserMapping mapping) {
        return "enabled".equals(mapping.desiredStatus())
                ? UserStatus.ACTIVE
                : UserStatus.INACTIVE;
    }

    private void reconcileMemberships(
            AppUser user, List<String> siteCodes, Map<String, Site> siteByCode) {
        Set<UUID> desiredSiteIds = siteCodes.stream()
                .map(siteByCode::get)
                .map(Site::getId)
                .collect(Collectors.toUnmodifiableSet());
        List<SiteMembership> existing = memberships.findByUserId(user.getId());
        List<SiteMembership> obsolete = existing.stream()
                .filter(membership -> !desiredSiteIds.contains(membership.getSiteId()))
                .toList();
        if (!obsolete.isEmpty()) {
            memberships.deleteAll(obsolete);
        }

        Set<UUID> existingSiteIds = existing.stream()
                .map(SiteMembership::getSiteId)
                .filter(desiredSiteIds::contains)
                .collect(Collectors.toCollection(HashSet::new));
        desiredSiteIds.stream()
                .filter(existingSiteId -> !existingSiteIds.contains(existingSiteId))
                .map(siteId -> new SiteMembership(user.getId(), siteId))
                .forEach(memberships::save);
    }

    static List<DemoUserMapping> parseAndValidateMappings(ObjectMapper mapper, String json) {
        final List<DemoUserMapping> mappings;
        try {
            mappings = mapper.readValue(json, new TypeReference<>() {});
        } catch (Exception exception) {
            throw new IllegalArgumentException("Mapping JSON is malformed.", exception);
        }
        if (mappings == null || mappings.stream().anyMatch(java.util.Objects::isNull)
                || mappings.stream().map(DemoUserMapping::username).anyMatch(java.util.Objects::isNull)
                || mappings.stream().map(DemoUserMapping::username).distinct().count() != mappings.size()
                || mappings.stream().map(DemoUserMapping::cognitoSub).anyMatch(java.util.Objects::isNull)
                || mappings.stream().map(DemoUserMapping::cognitoSub).distinct().count() != mappings.size()) {
            throw new IllegalArgumentException("Mappings must contain unique usernames and Cognito subjects.");
        }
        for (DemoUserMapping mapping : mappings) {
            // A developer identity is normally a bare handle ("admin1"), but the live shared
            // pool sets username_attributes=["email"] (infra/terraform/cognito/main.tf) — an
            // account meant to exist there needs an email-shaped username too. Scoped to the
            // same reserved @synthetic.crewsafe.invalid namespace synthetic-test already uses,
            // so this never opens the door to a real address, just a second accepted shape.
            boolean developerUsername = "developer".equals(mapping.identityKind())
                    && (mapping.username().matches("^[a-z0-9]++([._-][a-z0-9]++)*+$")
                        || mapping.username().matches("^[a-z0-9][a-z0-9._+-]*@synthetic\\.crewsafe\\.invalid$"));
            boolean syntheticUsername = "synthetic-test".equals(mapping.identityKind())
                    && mapping.username().matches(
                            "^[a-z0-9][a-z0-9._+-]*@synthetic\\.crewsafe\\.invalid$")
                    && mapping.displayName() != null
                    && mapping.displayName().startsWith("Synthetic ");
            if (!(developerUsername || syntheticUsername)
                    || mapping.cognitoSub().isBlank() || mapping.cognitoSub().contains("@")
                    || mapping.displayName() == null || mapping.displayName().isBlank()
                    || mapping.displayName().length() > 100 || mapping.role() == null
                    || mapping.siteCodes() == null
                    || mapping.siteCodes().stream().anyMatch(java.util.Objects::isNull)
                    || mapping.siteCodes().stream().distinct().count() != mapping.siteCodes().size()
                    || mapping.identityKind() == null
                    || !List.of("developer", "synthetic-test").contains(mapping.identityKind())
                    || mapping.desiredStatus() == null
                    || ("developer".equals(mapping.identityKind())
                        && !"preserve".equals(mapping.desiredStatus()))
                    || ("synthetic-test".equals(mapping.identityKind())
                        && !List.of("enabled", "disabled").contains(mapping.desiredStatus()))
                    || mapping.siteCodes().stream().anyMatch(code -> !List.of("bishan", "campus").contains(code))) {
                throw new IllegalArgumentException("Mapping contains an unsafe subject, identity kind, or site code.");
            }
        }
        return List.copyOf(mappings);
    }

    record DemoUserMapping(String username, String cognitoSub, String displayName,
                           Role role, List<String> siteCodes, String identityKind,
                           String desiredStatus) {}
}
