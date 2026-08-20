package com.crewsafe.conditions.service;

import com.crewsafe.conditions.api.ConditionsHistoryResponse;
import com.crewsafe.weather.domain.WeatherObservation;
import com.crewsafe.weather.repository.WeatherObservationRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ConditionsHistoryServiceTest {

    private static final UUID SITE_ID = UUID.fromString("10000000-0000-0000-0000-000000000001");
    private static final Instant NOW = Instant.parse("2026-08-20T09:00:00Z");
    private static final Instant FROM = NOW.minus(Duration.ofHours(4));

    @Mock private WeatherObservationRepository observations;
    @Mock private WeatherObservation earlier;
    @Mock private WeatherObservation later;

    private ConditionsHistoryService service;

    @BeforeEach
    void setUp() {
        service = new ConditionsHistoryService(
                observations,
                Clock.fixed(NOW, ZoneOffset.UTC));
    }

    @Test
    void returnsAFourHourServerAnchoredTrendEnvelope() {
        Instant earlierAt = Instant.parse("2026-08-20T06:00:00Z");
        Instant laterAt = Instant.parse("2026-08-20T08:45:00Z");
        when(earlier.getObservedAt()).thenReturn(earlierAt);
        when(earlier.getWbgt()).thenReturn(new BigDecimal("27.30"));
        when(later.getObservedAt()).thenReturn(laterAt);
        when(later.getWbgt()).thenReturn(new BigDecimal("29.10"));
        when(observations.findWbgtHistory(SITE_ID, FROM, NOW))
                .thenReturn(List.of(earlier, later));

        ConditionsHistoryResponse response = service.getHistory(SITE_ID);

        assertThat(response.from()).isEqualTo(FROM);
        assertThat(response.asOf()).isEqualTo(NOW);
        assertThat(response.points())
                .extracting(point -> point.observedAt() + "|" + point.wbgt())
                .containsExactly(
                        "2026-08-20T06:00:00Z|27.30",
                        "2026-08-20T08:45:00Z|29.10");
        verify(observations).findWbgtHistory(SITE_ID, FROM, NOW);
    }
}
