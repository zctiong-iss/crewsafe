package com.crewsafe.policy.service;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.policy.domain.PolicyVersion;
import com.crewsafe.policy.domain.PolicyVersionStatus;
import com.crewsafe.policy.domain.WorkIntensity;
import com.crewsafe.policy.repository.PolicyVersionRepository;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Proves the V16-seeded company default is actually reached through the real, DI-wired path —
 * real Postgres via Flyway, the real {@link PolicyEngineService} bean, the real
 * {@link PolicyVersionRepository} — rather than the Mockito-simulated version in
 * {@link PolicyEngineServiceTest}, which never touches an actual migrated schema.
 *
 * @author Jemilin Beulah
 */
class PolicyEngineDefaultFallbackEndToEndTest extends AbstractIntegrationTest {

    @Autowired private PolicyEngineService policyEngine;
    @Autowired private SiteRepository sites;
    @Autowired private PolicyVersionRepository policyVersions;

    @Test
    void seededDefaultRowExists() {
        var defaultVersion = policyVersions.findBySiteIdIsNullAndStatus(PolicyVersionStatus.ACTIVE);
        assertThat(defaultVersion).isPresent();
        assertThat(defaultVersion.get().getVersionLabel()).isEqualTo("MOM-WBGT-2026-DEFAULT");
        assertThat(defaultVersion.get().getWbgtThresholdUnacclimatisedLight())
                .isEqualByComparingTo("25.0");
    }

    @Test
    void siteWithNoPolicyOfItsOwnFallsBackToRealSeededDefault() {
        Site freshSite = sites.save(new Site(
                "E2E fallback site " + UUID.randomUUID(),
                new BigDecimal("1.300000"), new BigDecimal("103.800000")));

        var decision = policyEngine.evaluate(
                freshSite.getId(), UUID.randomUUID(), 25.0, WorkIntensity.LIGHT, 1);

        assertThat(decision.policyVersion()).isEqualTo("MOM-WBGT-2026-DEFAULT");
    }

    @Test
    void siteWithItsOwnActivePolicyWinsOverTheRealSeededDefault() {
        Site siteWithOwnPolicy = sites.save(new Site(
                "E2E own-policy site " + UUID.randomUUID(),
                new BigDecimal("1.300000"), new BigDecimal("103.800000")));

        policyVersions.save(PolicyVersion.builder()
                .id(UUID.randomUUID())
                .siteId(siteWithOwnPolicy.getId())
                .versionLabel("E2E-OWN-POLICY")
                .source("test")
                .effectiveDate(LocalDate.now())
                .status(PolicyVersionStatus.ACTIVE)
                .wbgtThresholdUnacclimatisedLight(new BigDecimal("24.0"))
                .wbgtThresholdUnacclimatisedModerate(new BigDecimal("22.0"))
                .wbgtThresholdUnacclimatisedHeavy(new BigDecimal("20.0"))
                .wbgtThresholdPartialLight(new BigDecimal("25.0"))
                .wbgtThresholdPartialModerate(new BigDecimal("23.0"))
                .wbgtThresholdPartialHeavy(new BigDecimal("21.0"))
                .wbgtThresholdFullLight(new BigDecimal("27.0"))
                .wbgtThresholdFullModerate(new BigDecimal("25.0"))
                .wbgtThresholdFullHeavy(new BigDecimal("23.0"))
                .wbgtEmergencyStop(new BigDecimal("32.0"))
                .createdAt(Instant.now())
                .updatedAt(Instant.now())
                .build());

        var decision = policyEngine.evaluate(
                siteWithOwnPolicy.getId(), UUID.randomUUID(), 25.0, WorkIntensity.LIGHT, 1);

        assertThat(decision.policyVersion()).isEqualTo("E2E-OWN-POLICY");
    }
}
