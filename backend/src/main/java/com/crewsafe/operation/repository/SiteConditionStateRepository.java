package com.crewsafe.operation.repository;

import com.crewsafe.operation.domain.SiteConditionState;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

/**
 * @author Abu Bakar
 */
public interface SiteConditionStateRepository extends JpaRepository<SiteConditionState, UUID> {
}
