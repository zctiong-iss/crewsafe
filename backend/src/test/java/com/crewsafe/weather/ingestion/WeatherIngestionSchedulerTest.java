package com.crewsafe.weather.ingestion;

import org.junit.jupiter.api.Test;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class WeatherIngestionSchedulerTest {

    @Test
    void aFailedRunDoesNotPreventTheNextInvocation() {
        WeatherIngestionService service = mock(WeatherIngestionService.class);
        when(service.ingestCurrentConditions())
                .thenThrow(new IllegalStateException("upstream unavailable"))
                .thenReturn(new WeatherIngestionResult(1, 1, 0));
        WeatherIngestionScheduler scheduler = new WeatherIngestionScheduler(service);

        scheduler.ingest();
        scheduler.ingest();

        verify(service, times(2)).ingestCurrentConditions();
    }
}
