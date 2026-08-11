package com.crewsafe.wellbeing.repository;

import com.crewsafe.wellbeing.domain.WellbeingLog;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

/**
 * @author Justin Chua
 */
public interface WellbeingLogRepository extends JpaRepository<WellbeingLog, UUID> {

    /**
     * Every log on a shift, newest first.
     *
     * <p>The whole shift rather than a per-worker latest query: the supervisor view needs the
     * latest rest *and* the latest drink for *every* worker on the crew, which is four rows per
     * worker resolved client-side from one round trip, not 2N queries. A shift's log volume is
     * bounded by its crew and its length — tens of rows, not thousands.
     *
     * <p>{@code id} breaks ties, so two logs written in the same millisecond come back in a
     * stable order rather than whichever the database felt like.
     */
    List<WellbeingLog> findByShiftIdOrderByLoggedAtDescIdDesc(UUID shiftId);

    /** A worker's own logs on a shift, newest first — what the worker sees on My shift. */
    List<WellbeingLog> findByShiftIdAndWorkerIdOrderByLoggedAtDescIdDesc(UUID shiftId, UUID workerId);

    /**
     * Guards the instructed-rest auto-log against a completed dispatch being reported twice.
     *
     * <p>The unique constraint on {@code dispatch_id} would catch it too, but as a constraint
     * violation mid-transaction — this lets the service treat a repeat as the no-op it is.
     */
    boolean existsByDispatchId(UUID dispatchId);
}
