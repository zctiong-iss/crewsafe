package com.crewsafe.shift.api;

import com.crewsafe.common.error.ResourceNotFoundException;
import com.crewsafe.identity.security.CrewSafeUserPrincipal;
import com.crewsafe.shift.domain.Intensity;
import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.domain.ShiftAssignment;
import com.crewsafe.shift.service.ShiftService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Shift endpoints (SCRUM-160, extended by SCRUM-159/160-fix), implementing
 * {@code docs/api/shift.yaml} field for field.
 *
 * Every method is site-scoped the same way {@link com.crewsafe.site.api.SiteController}
 * is: {@code @PreAuthorize("@siteAccess.canAccess(#siteId)")}. Every mutating method —
 * create, correct or delete a shift; add, correct or remove an assignment — is
 * additionally role-gated to SUPERVISOR/SAFETY_MANAGER/ADMIN, the same role group
 * {@code SiteController}'s dashboard uses; a worker may read their site's shifts but not
 * plan them.
 *
 * <p>Every "not found" throws {@link ResourceNotFoundException} rather than building a
 * bare {@code ResponseEntity.notFound()} (SCRUM-263) — the latter bypasses {@code
 * GlobalExceptionHandler} entirely and ships a 404 with no body, breaking the contract's
 * promise that every error response carries an {@code ErrorResponse} JSON body.
 *
 * @author Abu Bakar
 */
@RestController
@RequestMapping("/api/v1/sites/{siteId}/shifts")
@RequiredArgsConstructor
public class ShiftController {

    private final ShiftService shiftService;

    public record ShiftAssignmentResponse(UUID id, UUID workerId, String taskName, String intensity,
                                           Integer acclimatisationDay) {
        static ShiftAssignmentResponse from(ShiftAssignment assignment) {
            return new ShiftAssignmentResponse(assignment.getId(), assignment.getWorkerId(),
                    assignment.getTaskName(), assignment.getIntensity().name(),
                    assignment.getAcclimatisationDay());
        }
    }

    public record ShiftResponse(UUID id, UUID siteId, Instant startsAt, Instant endsAt, String status,
                                 List<ShiftAssignmentResponse> assignments) {
        static ShiftResponse from(Shift shift, List<ShiftAssignment> assignments) {
            return new ShiftResponse(shift.getId(), shift.getSiteId(), shift.getStartsAt(),
                    shift.getEndsAt(), shift.getStatus().name(),
                    assignments.stream().map(ShiftAssignmentResponse::from).toList());
        }
    }

    public record ShiftAssignmentCreateRequest(
            @NotNull UUID workerId,
            @Size(max = 120) String taskName,
            @NotNull Intensity intensity,
            @Min(1) @Max(7) Integer acclimatisationDay) {

        ShiftService.AssignmentInput toInput() {
            return new ShiftService.AssignmentInput(workerId, taskName, intensity, acclimatisationDay);
        }
    }

    public record ShiftCreateRequest(
            @NotNull Instant startsAt,
            @NotNull Instant endsAt,
            List<@Valid ShiftAssignmentCreateRequest> assignments) {

        List<ShiftAssignmentCreateRequest> assignmentsOrEmpty() {
            return assignments == null ? List.of() : assignments;
        }
    }

    public record ShiftUpdateRequest(@NotNull Instant startsAt, @NotNull Instant endsAt) {
    }

    /** No {@code workerId} field, deliberately — see {@link ShiftService#updateAssignment}. */
    public record ShiftAssignmentUpdateRequest(
            @Size(max = 120) String taskName,
            @NotNull Intensity intensity,
            @Min(1) @Max(7) Integer acclimatisationDay) {
    }

    @GetMapping
    @PreAuthorize("@siteAccess.canAccess(#siteId)")
    public ResponseEntity<List<ShiftResponse>> listShifts(@PathVariable UUID siteId) {
        List<Shift> siteShifts = shiftService.listShifts(siteId);
        Map<UUID, List<ShiftAssignment>> byShift = shiftService.assignmentsGroupedByShiftId(
                siteShifts.stream().map(Shift::getId).toList());

        return ResponseEntity.ok(siteShifts.stream()
                .map(shift -> ShiftResponse.from(shift, byShift.getOrDefault(shift.getId(), List.of())))
                .toList());
    }

    @PostMapping
    @PreAuthorize("hasAnyRole('SUPERVISOR', 'SAFETY_MANAGER', 'ADMIN') and @siteAccess.canAccess(#siteId)")
    public ResponseEntity<ShiftResponse> createShift(@PathVariable UUID siteId,
            @AuthenticationPrincipal CrewSafeUserPrincipal principal,
            @Valid @RequestBody ShiftCreateRequest request) {

        Shift shift = shiftService.createShift(siteId, principal.getId(), request.startsAt(), request.endsAt(),
                request.assignmentsOrEmpty().stream().map(ShiftAssignmentCreateRequest::toInput).toList());

        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ShiftResponse.from(shift, shiftService.assignmentsFor(shift.getId())));
    }

    @GetMapping("/{shiftId}")
    @PreAuthorize("@siteAccess.canAccess(#siteId)")
    public ResponseEntity<ShiftResponse> getShift(@PathVariable UUID siteId, @PathVariable UUID shiftId) {
        Shift shift = shiftService.getShift(siteId, shiftId)
                .orElseThrow(() -> noSuchShift(siteId, shiftId));

        return ResponseEntity.ok(ShiftResponse.from(shift, shiftService.assignmentsFor(shift.getId())));
    }

    @PatchMapping("/{shiftId}")
    @PreAuthorize("hasAnyRole('SUPERVISOR', 'SAFETY_MANAGER', 'ADMIN') and @siteAccess.canAccess(#siteId)")
    public ResponseEntity<ShiftResponse> updateShift(@PathVariable UUID siteId, @PathVariable UUID shiftId,
            @AuthenticationPrincipal CrewSafeUserPrincipal principal,
            @Valid @RequestBody ShiftUpdateRequest request) {

        Shift shift = shiftService.updateShift(siteId, principal.getId(), shiftId, request.startsAt(), request.endsAt())
                .orElseThrow(() -> noSuchShift(siteId, shiftId));

        return ResponseEntity.ok(ShiftResponse.from(shift, shiftService.assignmentsFor(shift.getId())));
    }

    @DeleteMapping("/{shiftId}")
    @PreAuthorize("hasAnyRole('SUPERVISOR', 'SAFETY_MANAGER', 'ADMIN') and @siteAccess.canAccess(#siteId)")
    public ResponseEntity<Void> deleteShift(@PathVariable UUID siteId, @PathVariable UUID shiftId,
            @AuthenticationPrincipal CrewSafeUserPrincipal principal) {

        if (!shiftService.deleteShift(siteId, principal.getId(), shiftId)) {
            throw noSuchShift(siteId, shiftId);
        }

        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{shiftId}/cancel")
    @PreAuthorize("hasAnyRole('SUPERVISOR', 'SAFETY_MANAGER', 'ADMIN') and @siteAccess.canAccess(#siteId)")
    public ResponseEntity<ShiftResponse> cancelShift(@PathVariable UUID siteId, @PathVariable UUID shiftId,
            @AuthenticationPrincipal CrewSafeUserPrincipal principal) {

        return shiftService.cancelShift(siteId, principal.getId(), shiftId)
                .map(shift -> ShiftResponse.from(shift, shiftService.assignmentsFor(shift.getId())))
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PostMapping("/{shiftId}/assignments")
    @PreAuthorize("hasAnyRole('SUPERVISOR', 'SAFETY_MANAGER', 'ADMIN') and @siteAccess.canAccess(#siteId)")
    public ResponseEntity<ShiftResponse> addShiftAssignment(@PathVariable UUID siteId, @PathVariable UUID shiftId,
            @Valid @RequestBody ShiftAssignmentCreateRequest request) {

        Shift shift = shiftService.addAssignment(siteId, shiftId, request.toInput())
                .orElseThrow(() -> noSuchShift(siteId, shiftId));

        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ShiftResponse.from(shift, shiftService.assignmentsFor(shift.getId())));
    }

    @PatchMapping("/{shiftId}/assignments/{assignmentId}")
    @PreAuthorize("hasAnyRole('SUPERVISOR', 'SAFETY_MANAGER', 'ADMIN') and @siteAccess.canAccess(#siteId)")
    public ResponseEntity<ShiftResponse> updateShiftAssignment(@PathVariable UUID siteId,
            @PathVariable UUID shiftId, @PathVariable UUID assignmentId,
            @AuthenticationPrincipal CrewSafeUserPrincipal principal,
            @Valid @RequestBody ShiftAssignmentUpdateRequest request) {

        Shift shift = shiftService.updateAssignment(siteId, principal.getId(), shiftId, assignmentId,
                        request.taskName(), request.intensity(), request.acclimatisationDay())
                .orElseThrow(() -> noSuchAssignment(siteId, shiftId, assignmentId));

        return ResponseEntity.ok(ShiftResponse.from(shift, shiftService.assignmentsFor(shift.getId())));
    }

    @DeleteMapping("/{shiftId}/assignments/{assignmentId}")
    @PreAuthorize("hasAnyRole('SUPERVISOR', 'SAFETY_MANAGER', 'ADMIN') and @siteAccess.canAccess(#siteId)")
    public ResponseEntity<Void> removeShiftAssignment(@PathVariable UUID siteId, @PathVariable UUID shiftId,
            @PathVariable UUID assignmentId, @AuthenticationPrincipal CrewSafeUserPrincipal principal) {

        if (!shiftService.removeAssignment(siteId, principal.getId(), shiftId, assignmentId)) {
            throw noSuchAssignment(siteId, shiftId, assignmentId);
        }

        return ResponseEntity.noContent().build();
    }

    private static ResourceNotFoundException noSuchShift(UUID siteId, UUID shiftId) {
        return new ResourceNotFoundException("No shift " + shiftId + " under site " + siteId);
    }

    private static ResourceNotFoundException noSuchAssignment(UUID siteId, UUID shiftId, UUID assignmentId) {
        return new ResourceNotFoundException("No shift " + shiftId + " under site " + siteId
                + ", or no assignment " + assignmentId + " on that shift");
    }
}
