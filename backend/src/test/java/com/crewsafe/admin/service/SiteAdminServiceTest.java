package com.crewsafe.admin.service;

import com.crewsafe.common.audit.AuditService;
import com.crewsafe.common.error.ConflictException;
import com.crewsafe.common.error.ResourceNotFoundException;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link SiteAdminService} (US-30).
 *
 * @author Jemilin Beulah
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("SiteAdminService")
class SiteAdminServiceTest {

    @Mock
    private SiteRepository sites;

    @Mock
    private AuditService audit;

    private SiteAdminService service;
    private UUID actorId;

    @BeforeEach
    void setUp() {
        service = new SiteAdminService(sites, audit);
        actorId = UUID.randomUUID();

        when(sites.save(any(Site.class))).thenAnswer(invocation -> invocation.getArgument(0));
    }

    private static Site site(String name) {
        return new Site(name, new BigDecimal("1.300000"), new BigDecimal("103.800000"));
    }

    @Nested
    @DisplayName("create")
    class Create {

        @Test
        @DisplayName("Duplicate name → ConflictException")
        void duplicateName() {
            when(sites.findByName("Bishan Park")).thenReturn(Optional.of(site("Bishan Park")));

            assertThatThrownBy(() -> service.create("Bishan Park",
                    new BigDecimal("1.3"), new BigDecimal("103.8"), actorId))
                    .isInstanceOf(ConflictException.class);

            verify(sites, never()).save(any());
        }

        @Test
        @DisplayName("New name → saved and audited")
        void createsAndAudits() {
            when(sites.findByName("New Site")).thenReturn(Optional.empty());

            Site saved = service.create("New Site", new BigDecimal("1.3"), new BigDecimal("103.8"), actorId);

            assertThat(saved.getName()).isEqualTo("New Site");
            assertThat(saved.isArchived()).isFalse();
            verify(audit).record(eq(actorId), eq("SITE_CREATED"), eq("SITE"), eq(saved.getId()), anyString());
        }
    }

    @Nested
    @DisplayName("update")
    class Update {

        @Test
        @DisplayName("Unknown site → ResourceNotFoundException")
        void unknownSite() {
            UUID siteId = UUID.randomUUID();
            when(sites.findById(siteId)).thenReturn(Optional.empty());

            assertThatThrownBy(() -> service.update(siteId, "New Name",
                    new BigDecimal("1.3"), new BigDecimal("103.8"), actorId))
                    .isInstanceOf(ResourceNotFoundException.class);
        }

        @Test
        @DisplayName("Renaming to another site's existing name → ConflictException")
        void renameCollision() {
            Site target = site("Old Name");
            when(sites.findById(target.getId())).thenReturn(Optional.of(target));
            when(sites.findByName("Taken")).thenReturn(Optional.of(site("Taken")));

            assertThatThrownBy(() -> service.update(target.getId(), "Taken",
                    new BigDecimal("1.3"), new BigDecimal("103.8"), actorId))
                    .isInstanceOf(ConflictException.class);
        }

        @Test
        @DisplayName("Renaming to its own current name is not a collision")
        void renameToOwnNameIsFine() {
            Site target = site("Same Name");
            when(sites.findById(target.getId())).thenReturn(Optional.of(target));
            when(sites.findByName("Same Name")).thenReturn(Optional.of(target));

            Site saved = service.update(target.getId(), "Same Name",
                    new BigDecimal("1.4"), new BigDecimal("103.9"), actorId);

            assertThat(saved.getLatitude()).isEqualByComparingTo("1.4");
            verify(audit).record(eq(actorId), eq("SITE_UPDATED"), eq("SITE"), eq(target.getId()), anyString());
        }
    }

    @Nested
    @DisplayName("archive / unarchive")
    class ArchiveUnarchive {

        @Test
        @DisplayName("Archiving an active site sets the flag and audits")
        void archives() {
            Site target = site("Active Site");
            when(sites.findById(target.getId())).thenReturn(Optional.of(target));

            Site result = service.archive(target.getId(), actorId);

            assertThat(result.isArchived()).isTrue();
            verify(audit).record(eq(actorId), eq("SITE_ARCHIVED"), eq("SITE"), eq(target.getId()), anyString());
        }

        @Test
        @DisplayName("Archiving an already-archived site is an idempotent no-op")
        void archivingAlreadyArchivedIsNoOp() {
            Site target = site("Already Archived");
            target.setArchived(true);
            when(sites.findById(target.getId())).thenReturn(Optional.of(target));

            Site result = service.archive(target.getId(), actorId);

            assertThat(result).isSameAs(target);
            verify(sites, never()).save(any());
            verify(audit, never()).record(any(), anyString(), anyString(), any(), anyString());
        }

        @Test
        @DisplayName("Unarchiving an archived site clears the flag and audits")
        void unarchives() {
            Site target = site("Archived Site");
            target.setArchived(true);
            when(sites.findById(target.getId())).thenReturn(Optional.of(target));

            Site result = service.unarchive(target.getId(), actorId);

            assertThat(result.isArchived()).isFalse();
            verify(audit).record(eq(actorId), eq("SITE_UNARCHIVED"), eq("SITE"), eq(target.getId()), anyString());
        }

        @Test
        @DisplayName("Unarchiving a non-archived site is an idempotent no-op")
        void unarchivingNonArchivedIsNoOp() {
            Site target = site("Never Archived");
            when(sites.findById(target.getId())).thenReturn(Optional.of(target));

            Site result = service.unarchive(target.getId(), actorId);

            assertThat(result).isSameAs(target);
            verify(sites, never()).save(any());
        }
    }
}
