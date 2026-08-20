package com.crewsafe.conditions.api;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/** Four-hour WBGT trend data anchored to the backend clock. */
public record ConditionsHistoryResponse(
        Instant from,
        Instant asOf,
        List<ConditionsHistoryPoint> points
) {
    public record ConditionsHistoryPoint(Instant observedAt, BigDecimal wbgt) {
    }
}
