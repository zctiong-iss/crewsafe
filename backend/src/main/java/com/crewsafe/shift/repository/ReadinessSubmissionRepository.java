package com.crewsafe.shift.repository;

import com.crewsafe.shift.domain.ReadinessSubmission;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface ReadinessSubmissionRepository extends JpaRepository<ReadinessSubmission, UUID> {

    /** The timestamp decides recency; id provides deterministic ordering for exact ties. */
    Optional<ReadinessSubmission> findFirstByShiftIdAndWorkerIdOrderBySubmittedAtDescIdDesc(
            UUID shiftId, UUID workerId);

    long countByShiftIdAndWorkerId(UUID shiftId, UUID workerId);
}
