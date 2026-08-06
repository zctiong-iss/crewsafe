package com.crewsafe.lightning.ingestion;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Runs live lightning ingestion at the configured cadence without terminating future runs on failure.
 *
 * @author Jemilin Beulah
 */
@Component
@ConditionalOnProperty(prefix = "app.lightning.ingestion", name = "enabled", havingValue = "true")
@RequiredArgsConstructor
@Slf4j
public class LightningIngestionScheduler {

    private final LightningIngestionService ingestionService;

    @Scheduled(
            initialDelayString = "${app.lightning.ingestion.initial-delay}",
            fixedDelayString = "${app.lightning.ingestion.interval}"
    )
    public void ingest() {
        try {
            LightningIngestionResult result = ingestionService.ingestCurrentConditions();
            log.info("NEA lightning ingestion completed: sites={}, inserted={}, duplicates={}",
                    result.sitesProcessed(), result.inserted(), result.duplicates());
        } catch (RuntimeException exception) {
            // A scheduled task stops running forever if its exception escapes. Record the
            // failure and let Spring invoke the next interval, where the DB constraint
            // makes a retry safe.
            log.error("NEA lightning ingestion failed; the next scheduled run will retry", exception);
        }
    }
}
