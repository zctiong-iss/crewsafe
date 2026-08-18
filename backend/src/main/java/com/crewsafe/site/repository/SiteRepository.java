package com.crewsafe.site.repository;

import com.crewsafe.site.domain.Site;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * @author Jemilin Beulah
 */
public interface SiteRepository extends JpaRepository<Site, UUID> {

    Optional<Site> findByName(String name);

    /** The normal site switcher's source list — an archived site has no place in it. */
    List<Site> findByArchivedFalse();
}
