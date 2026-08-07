package com.crewsafe.lightning.ingestion;

/**
 * Counts produced by one scheduler run for logs, metrics, and tests.
 *
 * @author Jemilin Beulah
 */
public record LightningIngestionResult(int sitesProcessed, int inserted, int duplicates) {

    public static LightningIngestionResult noSites() {
        return new LightningIngestionResult(0, 0, 0);
    }
}
