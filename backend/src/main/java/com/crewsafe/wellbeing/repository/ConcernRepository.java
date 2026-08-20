package com.crewsafe.wellbeing.repository;

import com.crewsafe.wellbeing.domain.Concern;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * @author Justin Chua
 */
public interface ConcernRepository extends JpaRepository<Concern, UUID> {

    /** Newest first — a concern raised two minutes ago matters more than one from this morning. */
    List<Concern> findByShiftIdOrderByRaisedAtDescIdDesc(UUID shiftId);

    List<Concern> findByShiftIdInOrderByRaisedAtDescIdDesc(List<UUID> shiftIds);

    List<Concern> findByShiftIdInAndStatusOrderByRaisedAtDescIdDesc(
            List<UUID> shiftIds, Concern.ConcernStatus status);

    /** Scoped to the shift so a concern id from another shift reads as 404, not as someone else's. */
    Optional<Concern> findByIdAndShiftId(UUID id, UUID shiftId);

    List<Concern> findByShiftIdAndWorkerIdOrderByRaisedAtDescIdDesc(UUID shiftId, UUID workerId);
}
