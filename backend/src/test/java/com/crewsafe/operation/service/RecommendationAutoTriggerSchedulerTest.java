package com.crewsafe.operation.service;

import org.junit.jupiter.api.Test;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** @author Abu Bakar */
class RecommendationAutoTriggerSchedulerTest {

    @Test
    void aFailedRunDoesNotPreventTheNextInvocation() {
        RecommendationAutoTriggerService service = mock(RecommendationAutoTriggerService.class);
        when(service.evaluateAllSites())
                .thenThrow(new IllegalStateException("db unavailable"))
                .thenReturn(0);
        RecommendationAutoTriggerScheduler scheduler = new RecommendationAutoTriggerScheduler(service);

        scheduler.evaluate();
        scheduler.evaluate();

        verify(service, times(2)).evaluateAllSites();
    }

    @Test
    void delegatesToTheAutoTriggerServiceForTheActualEvaluation() {
        RecommendationAutoTriggerService service = mock(RecommendationAutoTriggerService.class);
        when(service.evaluateAllSites()).thenReturn(3);
        RecommendationAutoTriggerScheduler scheduler = new RecommendationAutoTriggerScheduler(service);

        scheduler.evaluate();

        verify(service).evaluateAllSites();
    }
}
