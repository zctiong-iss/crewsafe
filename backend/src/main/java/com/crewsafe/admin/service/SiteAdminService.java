package com.crewsafe.admin.service;

import com.crewsafe.common.audit.AuditEventType;
import com.crewsafe.common.audit.AuditService;
import com.crewsafe.common.error.ConflictException;
import com.crewsafe.common.error.ResourceNotFoundException;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

/**
 * Admin-only site CRUD (US-30) — create, rename/relocate and archive a site. Reads are
 * unfiltered (includes archived sites, so an admin can find one to unarchive); every other
 * consumer in the app goes through {@code SiteController}, which excludes them.
 *
 * <p>A site is archived, never deleted — matching this codebase's existing cancel-not-delete
 * convention (see {@code SHIFT_CANCELLED} vs {@code SHIFT_DELETED}). Its policy versions,
 * shifts and memberships all stay intact.
 *
 * @author Jemilin Beulah
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class SiteAdminService {

    private final SiteRepository sites;
    private final AuditService audit;

    /** Every site, archived or not, newest name-sorted. */
    public List<Site> list() {
        return sites.findAll().stream()
                .sorted(Comparator.comparing(Site::getName))
                .toList();
    }

    /**
     * @throws ConflictException if a site with this name already exists
     */
    @Transactional
    public Site create(String name, BigDecimal latitude, BigDecimal longitude, UUID actorId) {
        if (sites.findByName(name).isPresent()) {
            throw new ConflictException("A site named " + name + " already exists");
        }

        Site saved = sites.save(new Site(name, latitude, longitude));

        audit.record(actorId, AuditEventType.SITE_CREATED, "SITE", saved.getId(),
                "Site " + saved.getName() + " created");

        return saved;
    }

    /**
     * @throws ResourceNotFoundException if no site with this id exists
     * @throws ConflictException if another site already has the requested name
     */
    @Transactional
    public Site update(UUID siteId, String name, BigDecimal latitude, BigDecimal longitude, UUID actorId) {
        Site site = sites.findById(siteId)
                .orElseThrow(() -> new ResourceNotFoundException("No site " + siteId));

        sites.findByName(name).filter(other -> !other.getId().equals(siteId)).ifPresent(other -> {
            throw new ConflictException("A site named " + name + " already exists");
        });

        site.setName(name);
        site.setLatitude(latitude);
        site.setLongitude(longitude);
        Site saved = sites.save(site);

        audit.record(actorId, AuditEventType.SITE_UPDATED, "SITE", saved.getId(),
                "Site " + saved.getName() + " updated");

        return saved;
    }

    /** Idempotent: archiving an already-archived site is a no-op that returns it unchanged. */
    @Transactional
    public Site archive(UUID siteId, UUID actorId) {
        Site site = sites.findById(siteId)
                .orElseThrow(() -> new ResourceNotFoundException("No site " + siteId));

        if (site.isArchived()) {
            return site;
        }

        site.setArchived(true);
        Site saved = sites.save(site);

        audit.record(actorId, AuditEventType.SITE_ARCHIVED, "SITE", saved.getId(),
                "Site " + saved.getName() + " archived");

        return saved;
    }

    /** Idempotent: unarchiving a site that isn't archived is a no-op that returns it unchanged. */
    @Transactional
    public Site unarchive(UUID siteId, UUID actorId) {
        Site site = sites.findById(siteId)
                .orElseThrow(() -> new ResourceNotFoundException("No site " + siteId));

        if (!site.isArchived()) {
            return site;
        }

        site.setArchived(false);
        Site saved = sites.save(site);

        audit.record(actorId, AuditEventType.SITE_UNARCHIVED, "SITE", saved.getId(),
                "Site " + saved.getName() + " unarchived");

        return saved;
    }
}
