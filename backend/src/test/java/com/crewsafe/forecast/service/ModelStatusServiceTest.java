package com.crewsafe.forecast.service;

import com.crewsafe.forecast.client.ModelStatusApiClient;
import com.crewsafe.forecast.client.ModelStatusApiClient.HorizonMetrics;
import com.crewsafe.forecast.client.ModelStatusApiClient.ModelStatusApiResponse;
import com.crewsafe.forecast.service.ModelStatusService.ModelStatus;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ModelStatusServiceTest {

    @Test
    void mapsTheClientResponseToTheBackendFacingStatus() {
        ModelStatusApiClient client = mock(ModelStatusApiClient.class);
        HorizonMetrics horizonMetrics = new HorizonMetrics(
                0.36, 0.61, 0.04, 0.36, 0.22, 0.03,
                Map.of("BELOW_31", 0.33, "AT_LEAST_33", 1.66),
                List.of(List.of(1, 0), List.of(0, 1)),
                67335);
        ModelStatusApiResponse apiResponse = new ModelStatusApiResponse(
                "wbgt-six-month-frozen-candidate-v2:hist-gradient-leaves-31",
                false,
                "A newer untouched evaluation period is required.",
                Map.of("30", horizonMetrics));
        when(client.modelStatus()).thenReturn(apiResponse);
        ModelStatusService service = new ModelStatusService(client);

        ModelStatus status = service.currentStatus();

        assertThat(status.modelVersion())
                .isEqualTo("wbgt-six-month-frozen-candidate-v2:hist-gradient-leaves-31");
        assertThat(status.approvedForInference()).isFalse();
        assertThat(status.approvalBlocker()).isEqualTo("A newer untouched evaluation period is required.");
        assertThat(status.horizons()).containsKey("30");
        assertThat(status.horizons().get("30").mae()).isEqualTo(0.36);
        assertThat(status.horizons().get("30").sampleCount()).isEqualTo(67335);
        assertThat(status.horizons().get("30").maeByActualBand()).isEqualTo(horizonMetrics.maeByActualBand());
        assertThat(status.horizons().get("30").confusionMatrix()).isEqualTo(horizonMetrics.confusionMatrix());
    }

    @Test
    void mapsAnEmptyHorizonsMapWhenNoModelIsConfigured() {
        ModelStatusApiClient client = mock(ModelStatusApiClient.class);
        ModelStatusApiResponse apiResponse = new ModelStatusApiResponse(
                "baseline-1.0.0", false, "no model configured", Map.of());
        when(client.modelStatus()).thenReturn(apiResponse);
        ModelStatusService service = new ModelStatusService(client);

        ModelStatus status = service.currentStatus();

        assertThat(status.modelVersion()).isEqualTo("baseline-1.0.0");
        assertThat(status.horizons()).isEmpty();
    }
}
