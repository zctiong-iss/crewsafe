package com.crewsafe.forecast.api;

import com.crewsafe.common.error.ResourceNotFoundException;
import com.crewsafe.forecast.service.SiteForecastService;
import com.crewsafe.forecast.service.SiteForecastService.SiteForecast;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/** Site-authorized backend door to the private Python forecast service. */
@RestController
@RequestMapping("/api/v1/sites/{siteId}/weather/forecast")
@RequiredArgsConstructor
public class ForecastController {

    private final SiteForecastService forecasts;

    @GetMapping
    @PreAuthorize("@siteAccess.canAccess(#siteId)")
    public ResponseEntity<SiteForecast> getForecast(
            @PathVariable UUID siteId,
            @RequestParam(defaultValue = "30") int horizonMinutes) {
        return forecasts.forecast(siteId, horizonMinutes)
                .map(ResponseEntity::ok)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "No site found for forecast " + siteId));
    }
}
