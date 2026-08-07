package com.crewsafe.lightning.nea;

/**
 * Application-facing port for the current NEA lightning batch. Kept separate from
 * {@code NeaWeatherClient}: a lightning reading is a geolocated strike, not a per-station
 * value, so it does not fit {@code NeaObservation}'s shape or {@code fetchAll()}'s
 * five-metric snapshot contract.
 *
 * @author Jemilin Beulah
 */
public interface NeaLightningClient {

    NeaLightningObservation fetchLatest();
}
