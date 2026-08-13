package com.crewsafe.operation.service;

import org.junit.jupiter.api.Test;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ActionDispatchSweepSchedulerTest {

    @Test
    void aFailedRunDoesNotPreventTheNextInvocation() {
        ActionDispatchService service = mock(ActionDispatchService.class);
        when(service.markLateDispatches())
                .thenThrow(new IllegalStateException("db unavailable"))
                .thenReturn(0);
        when(service.autoCompleteDispatches()).thenReturn(0);
        ActionDispatchSweepScheduler scheduler = new ActionDispatchSweepScheduler(service);

        scheduler.sweep();
        scheduler.sweep();

        verify(service, times(2)).markLateDispatches();
    }

    @Test
    void marksLateBeforeAutoCompletingSoOneSweepCanDoBoth() {
        ActionDispatchService service = mock(ActionDispatchService.class);
        when(service.markLateDispatches()).thenReturn(1);
        when(service.autoCompleteDispatches()).thenReturn(1);
        ActionDispatchSweepScheduler scheduler = new ActionDispatchSweepScheduler(service);

        scheduler.sweep();

        verify(service).markLateDispatches();
        verify(service).autoCompleteDispatches();
    }
}
