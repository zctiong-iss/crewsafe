package com.crewsafe.site.repository;

import com.crewsafe.site.domain.Site;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface SiteRepository extends JpaRepository<Site, UUID> {

    Optional<Site> findByName(String name);
}
