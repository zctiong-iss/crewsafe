package com.crewsafe.policy.service;

import com.crewsafe.common.audit.AuditService;
import com.crewsafe.common.error.BadRequestException;
import com.crewsafe.common.error.ConflictException;
import com.crewsafe.common.error.ResourceNotFoundException;
import com.crewsafe.policy.domain.PolicyVersion;
import com.crewsafe.policy.domain.PolicyVersionStatus;
import com.crewsafe.policy.repository.PolicyVersionRepository;
import com.crewsafe.site.repository.SiteRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link PolicyVersionService} (SCRUM-120).
 *
 * Tests cover:
 * - Creating a version: site existence, duplicate label, threshold ordering
 * - Bootstrap: a site's first-ever version is auto-activated
 * - Subsequent versions are created as DRAFT
 * - Activation: supersedes the previous ACTIVE version, is idempotent when already ACTIVE,
 *   refuses to reactivate a SUPERSEDED version
 * - Audit events are recorded for both create and activate
 *
 * @author Jemilin Beulah
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("PolicyVersionService")
class PolicyVersionServiceTest {

    private static BigDecimal bd(double value) {
        return BigDecimal.valueOf(value);
    }

    @Mock
    private PolicyVersionRepository policyVersions;

    @Mock
    private SiteRepository sites;

    @Mock
    private AuditService audit;

    private PolicyVersionService service;
    private UUID siteId;
    private UUID actorId;

    @BeforeEach
    void setUp() {
        service = new PolicyVersionService(policyVersions, sites, audit);
        siteId = UUID.randomUUID();
        actorId = UUID.randomUUID();

        when(sites.existsById(siteId)).thenReturn(true);
        when(policyVersions.save(any(PolicyVersion.class))).thenAnswer(invocation -> invocation.getArgument(0));
    }

    private PolicyVersion.PolicyVersionBuilder validDraft() {
        return PolicyVersion.builder()
                .versionLabel("MOM-WBGT-2026.2")
                .source("MOM Work-Rest Guidelines 2026 Rev B")
                .effectiveDate(LocalDate.now())
                .wbgtThresholdUnacclimatisedLight(bd(25.0))
                .wbgtThresholdUnacclimatisedModerate(bd(23.0))
                .wbgtThresholdUnacclimatisedHeavy(bd(21.0))
                .wbgtThresholdPartialLight(bd(26.0))
                .wbgtThresholdPartialModerate(bd(24.0))
                .wbgtThresholdPartialHeavy(bd(22.0))
                .wbgtThresholdFullLight(bd(28.0))
                .wbgtThresholdFullModerate(bd(26.0))
                .wbgtThresholdFullHeavy(bd(24.0))
                .wbgtEmergencyStop(bd(33.0));
    }

    @Nested
    @DisplayName("create")
    class Create {

        @Test
        @DisplayName("Unknown site → ResourceNotFoundException")
        void unknownSite() {
            UUID unknownSite = UUID.randomUUID();
            when(sites.existsById(unknownSite)).thenReturn(false);

            assertThatThrownBy(() -> service.create(unknownSite, validDraft().build(), actorId))
                    .isInstanceOf(ResourceNotFoundException.class);

            verify(policyVersions, never()).save(any());
        }

        @Test
        @DisplayName("Duplicate version label for the site → ConflictException")
        void duplicateLabel() {
            when(policyVersions.existsBySiteIdAndVersionLabel(siteId, "MOM-WBGT-2026.2")).thenReturn(true);

            assertThatThrownBy(() -> service.create(siteId, validDraft().build(), actorId))
                    .isInstanceOf(ConflictException.class);

            verify(policyVersions, never()).save(any());
        }

        @Test
        @DisplayName("Thresholds violating light >= moderate >= heavy → BadRequestException")
        void thresholdsOutOfOrder() {
            PolicyVersion draft = validDraft()
                    .wbgtThresholdUnacclimatisedLight(bd(20.0)) // now below moderate (23.0)
                    .build();

            assertThatThrownBy(() -> service.create(siteId, draft, actorId))
                    .isInstanceOf(BadRequestException.class);

            verify(policyVersions, never()).save(any());
        }

        @Test
        @DisplayName("Site's first version is auto-activated, not left as DRAFT")
        void firstVersionForSiteIsActivated() {
            when(policyVersions.findBySiteIdOrderByEffectiveDateDescCreatedAtDesc(siteId))
                    .thenReturn(List.of());

            PolicyVersion saved = service.create(siteId, validDraft().build(), actorId);

            assertThat(saved.getStatus()).isEqualTo(PolicyVersionStatus.ACTIVE);
            assertThat(saved.getActivatedAt()).isNotNull();
            assertThat(saved.getSiteId()).isEqualTo(siteId);
            assertThat(saved.getCreatedBy()).isEqualTo(actorId);

            verify(audit).record(eq(actorId), eq("POLICY_VERSION_CREATED"), eq("POLICY_VERSION"),
                    eq(saved.getId()), anyString());
        }

        @Test
        @DisplayName("A site with an existing version creates the new one as DRAFT")
        void subsequentVersionIsDraft() {
            PolicyVersion existing = validDraft().id(UUID.randomUUID()).versionLabel("MOM-WBGT-2026.1")
                    .status(PolicyVersionStatus.ACTIVE).build();
            when(policyVersions.findBySiteIdOrderByEffectiveDateDescCreatedAtDesc(siteId))
                    .thenReturn(List.of(existing));

            PolicyVersion saved = service.create(siteId, validDraft().build(), actorId);

            assertThat(saved.getStatus()).isEqualTo(PolicyVersionStatus.DRAFT);
            assertThat(saved.getActivatedAt()).isNull();
        }
    }

    @Nested
    @DisplayName("activate")
    class Activate {

        @Test
        @DisplayName("Unknown version under this site → ResourceNotFoundException")
        void unknownVersion() {
            UUID versionId = UUID.randomUUID();
            when(policyVersions.findBySiteIdAndId(siteId, versionId)).thenReturn(Optional.empty());

            assertThatThrownBy(() -> service.activate(siteId, versionId, actorId))
                    .isInstanceOf(ResourceNotFoundException.class);
        }

        @Test
        @DisplayName("Already ACTIVE → idempotent no-op, no audit event")
        void alreadyActiveIsNoOp() {
            PolicyVersion active = validDraft().id(UUID.randomUUID()).status(PolicyVersionStatus.ACTIVE).build();
            when(policyVersions.findBySiteIdAndId(siteId, active.getId())).thenReturn(Optional.of(active));

            PolicyVersion result = service.activate(siteId, active.getId(), actorId);

            assertThat(result).isSameAs(active);
            verify(policyVersions, never()).save(any());
            verify(audit, never()).record(any(), anyString(), anyString(), any(), anyString());
        }

        @Test
        @DisplayName("SUPERSEDED → ConflictException, never reactivated")
        void supersededCannotBeReactivated() {
            PolicyVersion superseded = validDraft().id(UUID.randomUUID())
                    .status(PolicyVersionStatus.SUPERSEDED).build();
            when(policyVersions.findBySiteIdAndId(siteId, superseded.getId())).thenReturn(Optional.of(superseded));

            assertThatThrownBy(() -> service.activate(siteId, superseded.getId(), actorId))
                    .isInstanceOf(ConflictException.class);

            verify(policyVersions, never()).save(any());
        }

        @Test
        @DisplayName("Activating a DRAFT supersedes the previously ACTIVE version")
        void supersedesPreviousActive() {
            PolicyVersion previouslyActive = validDraft().id(UUID.randomUUID()).versionLabel("MOM-WBGT-2026.1")
                    .status(PolicyVersionStatus.ACTIVE).build();
            PolicyVersion draft = validDraft().id(UUID.randomUUID()).status(PolicyVersionStatus.DRAFT).build();

            when(policyVersions.findBySiteIdAndId(siteId, draft.getId())).thenReturn(Optional.of(draft));
            when(policyVersions.findBySiteIdAndStatus(siteId, PolicyVersionStatus.ACTIVE))
                    .thenReturn(Optional.of(previouslyActive));

            PolicyVersion result = service.activate(siteId, draft.getId(), actorId);

            assertThat(result.getStatus()).isEqualTo(PolicyVersionStatus.ACTIVE);
            assertThat(result.getActivatedAt()).isNotNull();

            // The previous version is superseded via saveAndFlush, not save — its UPDATE must
            // reach Postgres before the target's ACTIVE update is issued, or the immediate
            // partial-unique constraint (uq_policy_version_active_per_site) rejects both rows
            // being ACTIVE at once, even momentarily within the same transaction.
            ArgumentCaptor<PolicyVersion> supersededCaptor = ArgumentCaptor.forClass(PolicyVersion.class);
            verify(policyVersions).saveAndFlush(supersededCaptor.capture());
            assertThat(supersededCaptor.getValue().getStatus()).isEqualTo(PolicyVersionStatus.SUPERSEDED);
            assertThat(supersededCaptor.getValue().getSupersededAt()).isNotNull();

            ArgumentCaptor<PolicyVersion> activatedCaptor = ArgumentCaptor.forClass(PolicyVersion.class);
            verify(policyVersions).save(activatedCaptor.capture());
            assertThat(activatedCaptor.getValue().getStatus()).isEqualTo(PolicyVersionStatus.ACTIVE);

            verify(audit).record(eq(actorId), eq("POLICY_VERSION_ACTIVATED"), eq("POLICY_VERSION"),
                    eq(draft.getId()), anyString());
        }

        @Test
        @DisplayName("Activating a DRAFT with no existing ACTIVE version just activates it")
        void activatesWithNoPreviousActive() {
            PolicyVersion draft = validDraft().id(UUID.randomUUID()).status(PolicyVersionStatus.DRAFT).build();

            when(policyVersions.findBySiteIdAndId(siteId, draft.getId())).thenReturn(Optional.of(draft));
            when(policyVersions.findBySiteIdAndStatus(siteId, PolicyVersionStatus.ACTIVE))
                    .thenReturn(Optional.empty());

            PolicyVersion result = service.activate(siteId, draft.getId(), actorId);

            assertThat(result.getStatus()).isEqualTo(PolicyVersionStatus.ACTIVE);
            verify(policyVersions, times(1)).save(any());
        }
    }

    @Nested
    @DisplayName("read paths")
    class ReadPaths {

        @Test
        @DisplayName("listForSite delegates to the newest-effective-first query")
        void listForSiteDelegates() {
            List<PolicyVersion> expected = List.of(validDraft().id(UUID.randomUUID()).build());
            when(policyVersions.findBySiteIdOrderByEffectiveDateDescCreatedAtDesc(siteId)).thenReturn(expected);

            assertThat(service.listForSite(siteId)).isEqualTo(expected);
        }

        @Test
        @DisplayName("getActive delegates to the ACTIVE-status lookup")
        void getActiveDelegates() {
            PolicyVersion active = validDraft().id(UUID.randomUUID()).status(PolicyVersionStatus.ACTIVE).build();
            when(policyVersions.findBySiteIdAndStatus(siteId, PolicyVersionStatus.ACTIVE))
                    .thenReturn(Optional.of(active));

            assertThat(service.getActive(siteId)).contains(active);
        }

        @Test
        @DisplayName("getEffective prefers the site's own ACTIVE version over the company default")
        void getEffectivePrefersSitesOwnVersion() {
            PolicyVersion ownVersion = validDraft().id(UUID.randomUUID()).status(PolicyVersionStatus.ACTIVE).build();
            when(policyVersions.findBySiteIdAndStatus(siteId, PolicyVersionStatus.ACTIVE))
                    .thenReturn(Optional.of(ownVersion));

            assertThat(service.getEffective(siteId)).contains(ownVersion);
            verify(policyVersions, never()).findBySiteIdIsNullAndStatus(any());
        }

        @Test
        @DisplayName("getEffective falls back to the company default when the site has none of its own")
        void getEffectiveFallsBackToDefault() {
            PolicyVersion companyDefault = validDraft().id(UUID.randomUUID())
                    .status(PolicyVersionStatus.ACTIVE).build();
            when(policyVersions.findBySiteIdAndStatus(siteId, PolicyVersionStatus.ACTIVE))
                    .thenReturn(Optional.empty());
            when(policyVersions.findBySiteIdIsNullAndStatus(PolicyVersionStatus.ACTIVE))
                    .thenReturn(Optional.of(companyDefault));

            assertThat(service.getEffective(siteId)).contains(companyDefault);
        }
    }
}
