package com.crewsafe.forecast.api;

import com.crewsafe.common.error.ResourceNotFoundException;
import com.crewsafe.forecast.service.SiteForecastService;
import com.crewsafe.forecast.service.SiteForecastService.SiteForecast;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ForecastControllerTest {

    @Test
    void returnsTheServiceForecastForAnExistingSite() {
        SiteForecastService service = mock(SiteForecastService.class);
        ForecastController controller = new ForecastController(service);
        UUID siteId = UUID.randomUUID();
        SiteForecast forecast = new SiteForecast(
                "wbgt",
                new BigDecimal("31.8"),
                30,
                "wbgt-v2:hist-gradient",
                new BigDecimal("30.8"),
                new BigDecimal("32.8"),
                Instant.parse("2026-08-14T04:00:00Z"),
                com.crewsafe.forecast.service.ForecastBasis.MODEL,
                5L,
                false,
                com.crewsafe.weather.domain.WbgtBand.BAND_31_TO_BELOW_32);
        when(service.forecast(siteId, 30)).thenReturn(Optional.of(forecast));

        var response = controller.getForecast(siteId, 30);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isEqualTo(forecast);
    }

    @Test
    void usesTheSharedJsonErrorPathForAnUnknownSite() {
        SiteForecastService service = mock(SiteForecastService.class);
        ForecastController controller = new ForecastController(service);
        UUID siteId = UUID.randomUUID();
        when(service.forecast(siteId, 30)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> controller.getForecast(siteId, 30))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void keepsTheEndpointBehindSiteAuthorization() throws NoSuchMethodException {
        PreAuthorize authorization = ForecastController.class
                .getMethod("getForecast", UUID.class, int.class)
                .getAnnotation(PreAuthorize.class);

        assertThat(authorization).isNotNull();
        assertThat(authorization.value()).isEqualTo("@siteAccess.canAccess(#siteId)");
    }
}
