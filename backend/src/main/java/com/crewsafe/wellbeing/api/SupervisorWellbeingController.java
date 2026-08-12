package com.crewsafe.wellbeing.api;

import com.crewsafe.identity.security.CrewSafeUserPrincipal;
import com.crewsafe.wellbeing.api.WorkerWellbeingController.ConcernResponse;
import com.crewsafe.wellbeing.api.WorkerWellbeingController.WellbeingLogResponse;
import com.crewsafe.wellbeing.domain.WellbeingLog;
import com.crewsafe.wellbeing.service.WellbeingService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * How a crew is coping, for the people responsible for them (US-11).
 *
 * <p>Site-scoped and role-gated like every other supervisor surface. {@code SAFETY_MANAGER} reads
 * the same data — oversight is the job — but only a {@code SUPERVISOR} or {@code ADMIN} may
 * acknowledge a concern, because acknowledging is a claim to have acted, not merely to have read.
 *
 * @author Justin Chua
 */
@RestController
@RequestMapping("/api/v1/sites/{siteId}")
@RequiredArgsConstructor
public class SupervisorWellbeingController {

    private final WellbeingService wellbeing;

    /**
     * One row per worker: when they last rested and last drank, and whether either was instructed.
     *
     * <p>Derived here rather than in each client. "Last rest" is a question with one right answer,
     * and three clients each folding a raw log list into it is three chances to disagree about
     * what "last" means.
     */
    public record CrewWellbeingRow(UUID workerId, Instant lastRestAt, String lastRestSource,
                                    Instant lastHydrationAt, int restCount, int hydrationCount) {
    }

    @GetMapping("/shifts/{shiftId}/wellbeing")
    @PreAuthorize("hasAnyRole('SUPERVISOR', 'SAFETY_MANAGER', 'ADMIN') and @siteAccess.canAccess(#siteId)")
    public ResponseEntity<List<CrewWellbeingRow>> crewWellbeing(
            @PathVariable UUID siteId, @PathVariable UUID shiftId) {

        return wellbeing.logsForShift(siteId, shiftId)
                .map(SupervisorWellbeingController::summarise)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /** The raw timeline, for a supervisor who wants more than the latest of each. */
    @GetMapping("/shifts/{shiftId}/wellbeing-logs")
    @PreAuthorize("hasAnyRole('SUPERVISOR', 'SAFETY_MANAGER', 'ADMIN') and @siteAccess.canAccess(#siteId)")
    public ResponseEntity<List<WellbeingLogResponse>> logs(
            @PathVariable UUID siteId, @PathVariable UUID shiftId) {

        return wellbeing.logsForShift(siteId, shiftId)
                .map(list -> list.stream().map(WellbeingLogResponse::from).toList())
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /** Every concern across the site's shifts, newest first — open ones are not filtered out
     *  server-side, so a supervisor can still see what was already handled. */
    @GetMapping("/concerns")
    @PreAuthorize("hasAnyRole('SUPERVISOR', 'SAFETY_MANAGER', 'ADMIN') and @siteAccess.canAccess(#siteId)")
    public ResponseEntity<List<ConcernResponse>> concerns(@PathVariable UUID siteId) {
        return ResponseEntity.ok(wellbeing.concernsForSite(siteId).stream()
                .map(ConcernResponse::from)
                .toList());
    }

    @PostMapping("/concerns/{concernId}/acknowledge")
    @PreAuthorize("hasAnyRole('SUPERVISOR', 'ADMIN') and @siteAccess.canAccess(#siteId)")
    public ResponseEntity<ConcernResponse> acknowledge(
            @PathVariable UUID siteId, @PathVariable UUID concernId,
            @AuthenticationPrincipal CrewSafeUserPrincipal principal) {

        return wellbeing.acknowledgeConcern(siteId, concernId, principal.getId())
                .map(ConcernResponse::from)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /**
     * Folds a shift's log list into one row per worker.
     *
     * <p>A worker with no logs at all does not appear — the client already knows the crew from the
     * shift and renders "no rest logged" for anyone missing here. Inventing empty rows would mean
     * this endpoint had to know the roster, which is the shift endpoint's job.
     */
    private static List<CrewWellbeingRow> summarise(List<WellbeingLog> logs) {
        Map<UUID, List<WellbeingLog>> byWorker = logs.stream()
                .collect(Collectors.groupingBy(WellbeingLog::getWorkerId));

        return byWorker.entrySet().stream().map(entry -> {
            List<WellbeingLog> rests = entry.getValue().stream()
                    .filter(log -> log.getLogType() == WellbeingLog.LogType.REST)
                    .sorted(Comparator.comparing(WellbeingLog::getLoggedAt).reversed())
                    .toList();
            List<WellbeingLog> drinks = entry.getValue().stream()
                    .filter(log -> log.getLogType() == WellbeingLog.LogType.HYDRATION)
                    .sorted(Comparator.comparing(WellbeingLog::getLoggedAt).reversed())
                    .toList();

            return new CrewWellbeingRow(
                    entry.getKey(),
                    rests.isEmpty() ? null : rests.get(0).getLoggedAt(),
                    rests.isEmpty() ? null : rests.get(0).getSource().name(),
                    drinks.isEmpty() ? null : drinks.get(0).getLoggedAt(),
                    rests.size(),
                    drinks.size());
        }).toList();
    }
}
