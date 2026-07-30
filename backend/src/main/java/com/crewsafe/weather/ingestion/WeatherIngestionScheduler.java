package com.crewsafe.weather.ingestion;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Runs live ingestion at the configured cadence without terminating future runs on failure. */
@Component
@ConditionalOnProperty(prefix = "app.weather.ingestion", name = "enabled", havingValue = "true")
@RequiredArgsConstructor
@Slf4j
public class WeatherIngestionScheduler {

    private final WeatherIngestionService ingestionService;

    @Scheduled(
            initialDelayString = "${app.weather.ingestion.initial-delay}",
            fixedDelayString = "${app.weather.ingestion.interval}"
    )
    public void ingest() {
        try {
            WeatherIngestionResult result = ingestionService.ingestCurrentConditions();
            log.info("NEA weather ingestion completed: sites={}, inserted={}, duplicates={}",
                    result.sitesProcessed(), result.inserted(), result.duplicates());
        } catch (RuntimeException exception) {
            // A scheduled task stops running forever if its exception escapes. Record the
            // failure and let Spring invoke the next interval, where the DB constraint
            // makes a retry safe.
            log.error("NEA weather ingestion failed; the next scheduled run will retry", exception);
        }
    }
}
