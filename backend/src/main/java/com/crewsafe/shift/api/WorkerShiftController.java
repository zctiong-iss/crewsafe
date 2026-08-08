package com.crewsafe.shift.api;

import com.crewsafe.common.error.ResourceNotFoundException;
import com.crewsafe.identity.security.CrewSafeUserPrincipal;
import com.crewsafe.shift.domain.ReadinessSubmission;
import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.domain.ShiftAssignment;
import com.crewsafe.shift.domain.SymptomFlag;
import com.crewsafe.shift.service.WorkerShiftService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Implements the worker endpoints defined by {@code docs/api/shift-readiness.yaml}. */
@RestController
@RequestMapping("/api/v1/shifts")
@RequiredArgsConstructor
public class WorkerShiftController {

    private final WorkerShiftService workerShiftService;

    public record ReadinessRequest(
            @NotNull Boolean fitToWork,
            @NotNull Boolean adequateSleep,
            @NotNull Boolean adequateHydration,
            @NotEmpty List<@NotNull SymptomFlag> symptoms) {
    }

    public record ReadinessResponse(UUID id, UUID shiftId, boolean fitToWork,
                                    boolean adequateSleep, boolean adequateHydration,
                                    List<SymptomFlag> symptoms, Instant submittedAt) {
        static ReadinessResponse from(ReadinessSubmission submission) {
            return new ReadinessResponse(submission.getId(), submission.getShiftId(),
                    submission.isFitToWork(), submission.isAdequateSleep(),
                    submission.isAdequateHydration(),
                    submission.getSymptoms().stream().sorted().toList(),
                    submission.getSubmittedAt());
        }
    }

    public record AssignmentResponse(String taskName, String intensity,
                                     Integer acclimatisationDay) {
        static AssignmentResponse from(ShiftAssignment assignment) {
            return new AssignmentResponse(assignment.getTaskName(),
                    assignment.getIntensity().name(), assignment.getAcclimatisationDay());
        }
    }

    public record ShiftResponse(UUID shiftId, UUID siteId, Instant startsAt, Instant endsAt,
                                String status, AssignmentResponse assignment,
                                ReadinessResponse latestReadiness) {
        static ShiftResponse from(WorkerShiftService.WorkerShift workerShift) {
            Shift shift = workerShift.shift();
            return new ShiftResponse(shift.getId(), shift.getSiteId(), shift.getStartsAt(),
                    shift.getEndsAt(), shift.getStatus().name(),
                    AssignmentResponse.from(workerShift.assignment()),
                    workerShift.latestReadiness() == null
                            ? null : ReadinessResponse.from(workerShift.latestReadiness()));
        }
    }

    public record MyShiftResponse(ShiftResponse shift) {
    }

    @GetMapping("/me")
    @PreAuthorize("hasRole('WORKER')")
    public ResponseEntity<MyShiftResponse> getMyShift(
            @AuthenticationPrincipal CrewSafeUserPrincipal principal) {
        ShiftResponse shift = workerShiftService.findCurrentOrNext(principal.getId())
                .map(ShiftResponse::from)
                .orElse(null);
        return ResponseEntity.ok(new MyShiftResponse(shift));
    }

    @PostMapping("/{shiftId}/readiness")
    @PreAuthorize("hasRole('WORKER')")
    public ResponseEntity<ReadinessResponse> submitReadiness(
            @PathVariable UUID shiftId,
            @AuthenticationPrincipal CrewSafeUserPrincipal principal,
            @Valid @RequestBody ReadinessRequest request) {
        ReadinessResponse response = workerShiftService.submitReadiness(principal.getId(), shiftId,
                        request.fitToWork(), request.adequateSleep(),
                        request.adequateHydration(), request.symptoms())
                .map(ReadinessResponse::from)
                .orElseThrow(() -> new ResourceNotFoundException("No shift " + shiftId));

        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }
}
