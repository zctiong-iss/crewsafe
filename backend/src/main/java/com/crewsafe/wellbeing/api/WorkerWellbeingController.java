package com.crewsafe.wellbeing.api;

import com.crewsafe.identity.security.CrewSafeUserPrincipal;
import com.crewsafe.shift.domain.SymptomFlag;
import com.crewsafe.wellbeing.domain.Concern;
import com.crewsafe.wellbeing.domain.WellbeingLog;
import com.crewsafe.wellbeing.service.WellbeingService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * What a worker reports about themselves (US-11).
 *
 * <p>Not site-scoped, and there is no {@code workerId} anywhere in a request or a path. The
 * subject is always the bearer of the token, so there is no field through which one worker could
 * log rest for another — a stronger guarantee than validating one, and the same shape
 * {@code /api/v1/shifts/me} already uses.
 *
 * <p>{@code WORKER} only. A supervisor has no assignment to log against, and offering them an
 * endpoint that would always fail the assignment check is worse than not offering it.
 *
 * @author Justin Chua
 */
@RestController
@RequestMapping("/api/v1/shifts/{shiftId}")
@RequiredArgsConstructor
public class WorkerWellbeingController {

    private final WellbeingService wellbeing;

    public record WellbeingLogRequest(@NotNull WellbeingLog.LogType logType) {
    }

    public record WellbeingLogResponse(UUID id, UUID shiftId, String logType, String source,
                                        Instant loggedAt) {
        static WellbeingLogResponse from(WellbeingLog log) {
            return new WellbeingLogResponse(log.getId(), log.getShiftId(), log.getLogType().name(),
                    log.getSource().name(), log.getLoggedAt());
        }
    }

    /** {@code note} is capped so a paste cannot fill the column; the app caps it too. */
    public record ConcernRequest(Set<SymptomFlag> symptoms, @Size(max = 500) String note) {
    }

    public record ConcernResponse(UUID id, UUID shiftId, UUID workerId, List<String> symptoms,
                                   String note, String status, Instant raisedAt,
                                   Instant acknowledgedAt) {
        public static ConcernResponse from(Concern concern) {
            return new ConcernResponse(concern.getId(), concern.getShiftId(), concern.getWorkerId(),
                    concern.getSymptoms().stream().map(Enum::name).sorted().toList(),
                    concern.getNote(), concern.getStatus().name(), concern.getRaisedAt(),
                    concern.getAcknowledgedAt());
        }
    }

    /** 201: a log is a new fact each time, never an update of the last one. */
    @PostMapping("/wellbeing-logs")
    @PreAuthorize("hasRole('WORKER')")
    public ResponseEntity<WellbeingLogResponse> log(
            @PathVariable UUID shiftId,
            @AuthenticationPrincipal CrewSafeUserPrincipal principal,
            @Valid @RequestBody WellbeingLogRequest request) {

        WellbeingLog saved = wellbeing.log(shiftId, principal.getId(), request.logType());
        return ResponseEntity.status(HttpStatus.CREATED).body(WellbeingLogResponse.from(saved));
    }

    @PostMapping("/concerns")
    @PreAuthorize("hasRole('WORKER')")
    public ResponseEntity<ConcernResponse> raiseConcern(
            @PathVariable UUID shiftId,
            @AuthenticationPrincipal CrewSafeUserPrincipal principal,
            @Valid @RequestBody ConcernRequest request) {

        Concern saved = wellbeing.raiseConcern(shiftId, principal.getId(), request.symptoms(), request.note());
        return ResponseEntity.status(HttpStatus.CREATED).body(ConcernResponse.from(saved));
    }
}
