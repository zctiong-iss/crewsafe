package com.crewsafe.shift.service;

import org.junit.jupiter.api.Test;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** @author Abu Bakar */
class ShiftActivationSchedulerTest {

    @Test
    void aFailedRunDoesNotPreventTheNextInvocation() {
        ShiftService service = mock(ShiftService.class);
        when(service.activateDueShifts())
                .thenThrow(new IllegalStateException("db unavailable"))
                .thenReturn(0);
        ShiftActivationScheduler scheduler = new ShiftActivationScheduler(service);

        scheduler.activate();
        scheduler.activate();

        verify(service, times(2)).activateDueShifts();
    }

    @Test
    void delegatesToShiftServiceForTheActualTransition() {
        ShiftService service = mock(ShiftService.class);
        when(service.activateDueShifts()).thenReturn(2);
        ShiftActivationScheduler scheduler = new ShiftActivationScheduler(service);

        scheduler.activate();

        verify(service).activateDueShifts();
    }
}
