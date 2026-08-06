package com.crewsafe.lightning.nea;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * One geolocated strike reading, cloud-to-ground ("G") or cloud-to-cloud ("C").
 *
 * @author Jemilin Beulah
 */
public record NeaLightningStrike(
        BigDecimal latitude,
        BigDecimal longitude,
        Instant struckAt,
        String type
) {
}
