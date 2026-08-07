package com.crewsafe.shift.service;

import com.crewsafe.common.error.BadRequestException;
import com.crewsafe.shift.domain.Intensity;
import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.domain.ShiftAssignment;
import com.crewsafe.shift.repository.ShiftAssignmentRepository;
import com.crewsafe.shift.repository.ShiftRepository;
import com.crewsafe.common.audit.AuditService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * When a shift may still be corrected (SCRUM-266).
 *
 * <p>The rule is enforced in the service rather than only in the app, because a rule that lives in
 * one client is a rule every other client ignores — and these endpoints accepted an edit at any
 * status until now.
 *
 * <p>The case worth the most attention is {@link #refusesWhenTheEndTimeHasPassedEvenIfNotClosed()}.
 * Nothing in the system currently moves a shift to {@code CLOSED} on a timer, so "finished" and
 * "marked finished" are different facts, and checking only the status would leave yesterday's
 * shifts editable indefinitely.
 *
 * @author Justin Chua
 */
class ShiftEditabilityTest {

    private static final Instant NOW = Instant.parse("2026-08-07T04:00:00Z");
    private static final UUID SITE = UUID.randomUUID();
    private static final UUID ACTOR = UUID.randomUUID();

    private ShiftRepository shifts;
    private ShiftAssignmentRepository assignments;
    private ShiftService service;

    @BeforeEach
    void setUp() {
        shifts = mock(ShiftRepository.class);
        assignments = mock(ShiftAssignmentRepository.class);
        service = new ShiftService(shifts, assignments, mock(AuditService.class),
                Clock.fixed(NOW, ZoneOffset.UTC));

        // The service defers its audit write to afterCommit, which needs a synchronization to
        // register against. Nothing here is transactional, so one is opened by hand — the
        // alternative is asserting the happy path only through the integration tests, where a
        // guard this cheap to get wrong deserves a unit test of its own.
        TransactionSynchronizationManager.initSynchronization();
    }

    @AfterEach
    void tearDown() {
        TransactionSynchronizationManager.clearSynchronization();
    }

    /** A shift still running: started an hour ago, ends in three. */
    private Shift ongoingShift() {
        return new Shift(SITE, NOW.minusSeconds(3600), NOW.plusSeconds(3 * 3600));
    }

    /** A shift that finished an hour ago, and which nothing has got round to closing. */
    private Shift finishedShift() {
        return new Shift(SITE, NOW.minusSeconds(5 * 3600), NOW.minusSeconds(3600));
    }

    @Test
    void allowsCorrectingAnAssignmentWhileTheShiftIsStillRunning() {
        Shift shift = ongoingShift();
        UUID assignmentId = UUID.randomUUID();
        ShiftAssignment assignment = new ShiftAssignment(
                shift.getId(), UUID.randomUUID(), "Kerb laying", Intensity.MODERATE, 3);

        when(shifts.findByIdAndSiteId(any(), any())).thenReturn(Optional.of(shift));
        when(assignments.findByIdAndShiftId(any(), any())).thenReturn(Optional.of(assignment));

        // ACTIVE is deliberately allowed. The app confirms it separately, because changing
        // intensity mid-shift changes the heat obligations the worker is already under — that
        // is a decision to make with eyes open, not one to forbid.
        service.updateAssignment(SITE, ACTOR, shift.getId(), assignmentId,
                "Kerb laying, east verge", Intensity.HEAVY, 4);

        assertThat(assignment.getIntensity()).isEqualTo(Intensity.HEAVY);
        assertThat(assignment.getAcclimatisationDay()).isEqualTo(4);
    }

    @Test
    void refusesWhenTheEndTimeHasPassedEvenIfNotClosed() {
        Shift shift = finishedShift();
        when(shifts.findByIdAndSiteId(any(), any())).thenReturn(Optional.of(shift));

        assertThatThrownBy(() -> service.updateAssignment(SITE, ACTOR, shift.getId(),
                UUID.randomUUID(), "Anything", Intensity.LIGHT, 1))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("already ended");

        // The assignment is never even looked up, let alone written.
        verify(assignments, never()).findByIdAndShiftId(any(), any());
    }

    @Test
    void refusesToCorrectTheShiftWindowOnceItHasEnded() {
        Shift shift = finishedShift();
        when(shifts.findByIdAndSiteId(any(), any())).thenReturn(Optional.of(shift));

        assertThatThrownBy(() -> service.updateShift(SITE, ACTOR, shift.getId(),
                NOW.minusSeconds(5 * 3600), NOW.plusSeconds(3600)))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    void refusesToAddAWorkerToAFinishedShift() {
        Shift shift = finishedShift();
        when(shifts.findByIdAndSiteId(any(), any())).thenReturn(Optional.of(shift));

        assertThatThrownBy(() -> service.addAssignment(SITE, shift.getId(),
                new ShiftService.AssignmentInput(UUID.randomUUID(), "Task", Intensity.LIGHT, 1)))
                .isInstanceOf(BadRequestException.class);

        verify(assignments, never()).save(any());
    }

    @Test
    void refusesToRemoveAWorkerFromAFinishedShift() {
        Shift shift = finishedShift();
        when(shifts.findByIdAndSiteId(any(), any())).thenReturn(Optional.of(shift));

        assertThatThrownBy(() -> service.removeAssignment(SITE, ACTOR, shift.getId(), UUID.randomUUID()))
                .isInstanceOf(BadRequestException.class);

        verify(assignments, never()).delete(any());
    }

    @Test
    void stillReportsAMissingShiftAsMissingRatherThanUneditable() {
        // Order matters: a shift that does not exist under this site is a 404, and must not be
        // reported as "you cannot edit that" — which would tell the caller it exists.
        when(shifts.findByIdAndSiteId(any(), any())).thenReturn(Optional.empty());

        assertThat(service.removeAssignment(SITE, ACTOR, UUID.randomUUID(), UUID.randomUUID()))
                .isFalse();
        assertThat(service.updateShift(SITE, ACTOR, UUID.randomUUID(),
                NOW, NOW.plusSeconds(3600))).isEmpty();
    }
}
