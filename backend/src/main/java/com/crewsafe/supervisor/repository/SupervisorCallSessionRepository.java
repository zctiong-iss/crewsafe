package com.crewsafe.supervisor.repository;

import com.crewsafe.supervisor.domain.CallStatus;
import com.crewsafe.supervisor.domain.SupervisorCallSession;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Repository for SupervisorCallSession entities.
 *
 * Provides database access for call session queries.
 */
@Repository
public interface SupervisorCallSessionRepository extends JpaRepository<SupervisorCallSession, UUID> {

    /**
     * Find all calls initiated by a worker, ordered by most recent first.
     *
     * @param workerId the worker's user ID
     * @return list of call sessions for the worker
     */
    List<SupervisorCallSession> findByWorkerIdOrderByInitiatedAtDesc(UUID workerId);

    /**
     * Find all calls for a supervisor, ordered by most recent first.
     *
     * @param supervisorId the supervisor's user ID
     * @return list of call sessions for the supervisor
     */
    List<SupervisorCallSession> findBySupervisorIdOrderByInitiatedAtDesc(UUID supervisorId);

    /**
     * Find calls for a specific site with given status.
     *
     * @param siteId the site ID
     * @param status the call status to filter by
     * @return list of matching call sessions
     */
    List<SupervisorCallSession> findBySiteIdAndStatusOrderByInitiatedAtDesc(UUID siteId, CallStatus status);

    /**
     * Find a call session by ID, ensuring the worker is the one who initiated it.
     * Used for authorization checks.
     *
     * @param id the call session ID
     * @param workerId the worker's user ID
     * @return optional containing the call if found and worker matches
     */
    Optional<SupervisorCallSession> findByIdAndWorkerId(UUID id, UUID workerId);

    /**
     * Find a call session by ID, ensuring the supervisor is the one being called.
     * Used for authorization checks.
     *
     * @param id the call session ID
     * @param supervisorId the supervisor's user ID
     * @return optional containing the call if found and supervisor matches
     */
    Optional<SupervisorCallSession> findByIdAndSupervisorId(UUID id, UUID supervisorId);

    /**
     * Count pending calls for a supervisor.
     *
     * @param supervisorId the supervisor's user ID
     * @return number of pending calls
     */
    long countBySupervisorIdAndStatus(UUID supervisorId, CallStatus status);
}
