package com.crewsafe.lightning.nea;

import java.time.Instant;
import java.util.List;

/**
 * One polled batch from the lightning feed. {@code strikes} may legitimately be empty — no
 * strikes were detected in this batch, which is different from the batch itself being stale
 * or missing.
 *
 * @author Jemilin Beulah
 */
public record NeaLightningObservation(
        Instant observedAt,
        List<NeaLightningStrike> strikes,
        boolean simulated
) {

    public NeaLightningObservation {
        strikes = List.copyOf(strikes);
    }

    public NeaLightningObservation(Instant observedAt, List<NeaLightningStrike> strikes) {
        this(observedAt, strikes, false);
    }
}
