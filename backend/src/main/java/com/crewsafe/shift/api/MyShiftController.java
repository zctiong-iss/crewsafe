package com.crewsafe.shift.api;

import com.crewsafe.identity.security.CrewSafeUserPrincipal;
import com.crewsafe.shift.domain.Intensity;
import com.crewsafe.shift.domain.ShiftStatus;
import com.crewsafe.shift.service.ShiftService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.UUID;

/**
 * The caller's own shift (SCRUM-266), implementing {@code docs/api/shift-readiness.yaml}.
 *
 * <p>Separate from {@link ShiftController} because it answers a different question. That one is
 * the supervisor's CRUD surface: site-scoped, and it returns every assignment on a shift. This is
 * scoped to the bearer token and returns <strong>only the caller's own assignment</strong> — a
 * worker has no business reading what task the person next to them was given.
 *
 * <p>There is no {@code workerId} anywhere in the request, by design. The contract is explicit
 * that no field exists for one worker to ask about another, which is a stronger guarantee than
 * checking one.
 *
 * <p>Until this existed the mobile app's shift screen ran on a fixture, so a supervisor's
 * correction was invisible to the worker it was about. That is what this closes.
 *
 * @author Justin Chua
 */
@RestController
@RequestMapping("/api/v1/shifts")
@RequiredArgsConstructor
public class MyShiftController {

    private final ShiftService shiftService;

    /**
     * Returns 200 with a null shift when nothing is scheduled.
     *
     * <p>Not a 404. "You have no shift today" is a legitimate answer to a question the caller was
     * entitled to ask, and the screen has an empty state for it; a 404 would say the endpoint is
     * missing, which is what it actually was until now.
     *
     * <p>Authenticated rather than {@code hasRole('WORKER')}. A supervisor calling this has no
     * assignment and so gets the same null answer — which is true, and kinder than a 403 that
     * implies they asked something forbidden.
     */
    @GetMapping("/me")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<MyShiftResponse> getMyShift(
            @AuthenticationPrincipal CrewSafeUserPrincipal principal) {

        return ResponseEntity.ok(shiftService.myCurrentOrNextShift(principal.getId())
                .map(MyShiftResponse::of)
                .orElseGet(MyShiftResponse::none));
    }

    /** Wraps the shift so that "no shift" is a field rather than an empty body. */
    public record MyShiftResponse(MyShiftView shift) {

        static MyShiftResponse none() {
            return new MyShiftResponse(null);
        }

        static MyShiftResponse of(ShiftService.MyShift my) {
            return new MyShiftResponse(new MyShiftView(
                    my.shift().getId(),
                    my.shift().getSiteId(),
                    my.shift().getStartsAt(),
                    my.shift().getEndsAt(),
                    my.shift().getStatus(),
                    new MyShiftAssignmentView(
                            my.assignment().getTaskName(),
                            my.assignment().getIntensity(),
                            my.assignment().getAcclimatisationDay())));
        }
    }

    public record MyShiftView(UUID shiftId, UUID siteId, Instant startsAt, Instant endsAt,
                               ShiftStatus status, MyShiftAssignmentView assignment) {
    }

    /**
     * The caller's own details and nothing else — no assignment id, no worker id.
     *
     * <p>Neither is omitted for brevity. An assignment id is the handle a supervisor uses to
     * correct an assignment, and this endpoint is read-only for the worker; a worker id would be
     * the caller's own, which they already know.
     */
    public record MyShiftAssignmentView(String taskName, Intensity intensity,
                                         Integer acclimatisationDay) {
    }
}
