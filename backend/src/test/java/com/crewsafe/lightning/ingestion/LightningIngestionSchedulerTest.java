package com.crewsafe.lightning.ingestion;

import org.junit.jupiter.api.Test;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** @author Jemilin Beulah */
class LightningIngestionSchedulerTest {

    @Test
    void aFailedRunDoesNotPreventTheNextInvocation() {
        LightningIngestionService service = mock(LightningIngestionService.class);
        when(service.ingestCurrentConditions())
                .thenThrow(new IllegalStateException("upstream unavailable"))
                .thenReturn(new LightningIngestionResult(1, 1, 0));
        LightningIngestionScheduler scheduler = new LightningIngestionScheduler(service);

        scheduler.ingest();
        scheduler.ingest();

        verify(service, times(2)).ingestCurrentConditions();
    }
}
