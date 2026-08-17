package com.crewsafe.shift.service;

import com.crewsafe.common.audit.AuditEventType;
import com.crewsafe.common.audit.AuditService;
import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.domain.ShiftStatus;
import com.crewsafe.shift.repository.ShiftAssignmentRepository;
import com.crewsafe.shift.repository.ShiftRepository;
import com.crewsafe.site.repository.SiteRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * {@link ShiftService#activateDueShifts()} (SCRUM-441) — the PLANNED → ACTIVE transition
 * behind {@link ShiftActivationScheduler}.
 *
 * @author Abu Bakar
 */
class ShiftActivationTest {

    private static final Instant NOW = Instant.parse("2026-08-17T04:00:00Z");
    private static final UUID SITE = UUID.randomUUID();

    private ShiftRepository shifts;
    private AuditService audit;
    private ShiftService service;

    @BeforeEach
    void setUp() {
        shifts = mock(ShiftRepository.class);
        audit = mock(AuditService.class);
        service = new ShiftService(shifts, mock(ShiftAssignmentRepository.class), audit,
                Clock.fixed(NOW, ZoneOffset.UTC), mock(SiteRepository.class));

        // activateDueShifts defers its audit write to afterCommit, same as every other
        // ShiftService mutation — see ShiftEditabilityTest for why a synchronization is
        // opened by hand here.
        TransactionSynchronizationManager.initSynchronization();
    }

    @AfterEach
    void tearDown() {
        TransactionSynchronizationManager.clearSynchronization();
    }

    @Test
    void activatesAPlannedShiftWhoseStartTimeHasPassed() {
        Shift shift = new Shift(SITE, NOW.minusSeconds(60), NOW.plusSeconds(3600));
        when(shifts.findByStatusAndStartsAtLessThanEqual(ShiftStatus.PLANNED, NOW))
                .thenReturn(List.of(shift));

        int activatedCount = service.activateDueShifts();

        assertThat(activatedCount).isEqualTo(1);
        assertThat(shift.getStatus()).isEqualTo(ShiftStatus.ACTIVE);
    }

    @Test
    void auditsTheTransitionWithANullActorSinceItsSystemTriggered() {
        Shift shift = new Shift(SITE, NOW.minusSeconds(60), NOW.plusSeconds(3600));
        when(shifts.findByStatusAndStartsAtLessThanEqual(ShiftStatus.PLANNED, NOW))
                .thenReturn(List.of(shift));

        service.activateDueShifts();
        TransactionSynchronizationManager.getSynchronizations().forEach(TransactionSynchronization::afterCommit);

        verify(audit).record(isNull(), eq(AuditEventType.SHIFT_ACTIVATED), eq("SHIFT"),
                eq(shift.getId()), any());
    }

    @Test
    void queriesOnlyPlannedSoCancelledShiftsAreNeverTouched() {
        // CANCELLED (and CLOSED) shifts are excluded by construction: the repository query
        // only ever matches PLANNED, so there is nothing for this method to accidentally
        // reactivate.
        when(shifts.findByStatusAndStartsAtLessThanEqual(ShiftStatus.PLANNED, NOW))
                .thenReturn(List.of());

        int activatedCount = service.activateDueShifts();

        assertThat(activatedCount).isZero();
        verifyNoInteractions(audit);
    }
}
