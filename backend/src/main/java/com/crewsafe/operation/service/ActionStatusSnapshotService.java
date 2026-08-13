package com.crewsafe.operation.service;

import com.crewsafe.operation.api.AlertCountResponse;
import com.crewsafe.operation.domain.ActionDispatch;
import com.crewsafe.operation.repository.ActionDispatchRepository;
import com.crewsafe.shift.domain.ShiftStatus;
import com.crewsafe.shift.repository.ShiftRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Resolves a site to its action dispatches for the SCRUM-317 stream, the same way {@code
 * ConditionsSnapshotService} resolves a site's active shift: a dispatch only reaches a
 * site via {@code approval.recommendation.shiftId}, so this looks up the site's current
 * {@code ACTIVE} shift first rather than joining through {@code Shift} directly. No active
 * shift means no dispatches and an all-zero count, not an error.
 *
 * @author Jemilin Beulah
 */
@Service
@RequiredArgsConstructor
public class ActionStatusSnapshotService {

    private final ActionDispatchRepository actionDispatchRepository;
    private final ShiftRepository shiftRepository;
    private final Clock clock;

    public List<ActionDispatch> getDispatchesForSite(UUID siteId) {
        return shiftRepository.findFirstBySiteIdAndStatusOrderByStartsAtDesc(siteId, ShiftStatus.ACTIVE)
                .map(shift -> actionDispatchRepository.findByShiftId(shift.getId()))
                .orElseGet(List::of);
    }

    /**
     * Derives counts from a dispatch list already fetched by {@link #getDispatchesForSite},
     * so a caller pushing both an {@code action-status} and an {@code alert-count} event per
     * tick (see {@code ActionStatusStreamService}) does it with one query, not two.
     * {@code completed} covers only this shift, per the SCRUM-317 contract -- not all-time.
     */
    public AlertCountResponse toAlertCount(UUID siteId, List<ActionDispatch> dispatches) {
        long pending = countByStatus(dispatches, ActionDispatch.ActionDispatchStatus.PENDING);
        long late = countByStatus(dispatches, ActionDispatch.ActionDispatchStatus.LATE);
        long acknowledged = countByStatus(dispatches, ActionDispatch.ActionDispatchStatus.ACKNOWLEDGED);
        long completed = countByStatus(dispatches, ActionDispatch.ActionDispatchStatus.COMPLETED);

        return new AlertCountResponse(siteId, pending, late, acknowledged, completed, Instant.now(clock));
    }

    private static long countByStatus(List<ActionDispatch> dispatches, ActionDispatch.ActionDispatchStatus status) {
        return dispatches.stream().filter(dispatch -> dispatch.getStatus() == status).count();
    }
}
