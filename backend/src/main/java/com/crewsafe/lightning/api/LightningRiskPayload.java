package com.crewsafe.lightning.api;

import com.crewsafe.lightning.domain.LightningRiskState;
import com.crewsafe.weather.domain.WeatherQualityStatus;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * The lightning half of a {@code ConditionsSnapshot}. {@code observedAt} and
 * {@code freshness} describe how current the underlying NEA feed is; {@code validUntil} is
 * the independent axis SCRUM-170 calls for — when {@code state} itself expires, regardless
 * of whether the feed keeps polling successfully. Both are recomputed on every read from
 * {@code LightningObservation} history, not trusted from storage.
 *
 * @author Jemilin Beulah
 */
public record LightningRiskPayload(LightningRiskState state, BigDecimal nearestStrikeKm,
                                    Instant observedAt, Instant validUntil,
                                    WeatherQualityStatus freshness) {
}
