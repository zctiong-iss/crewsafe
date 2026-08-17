package com.crewsafe.forecast.service;

import com.crewsafe.forecast.client.ModelCardApiClient;
import com.crewsafe.forecast.client.ModelCardApiClient.Calibration;
import com.crewsafe.forecast.client.ModelCardApiClient.HorizonCard;
import com.crewsafe.forecast.client.ModelCardApiClient.ModelCardApiResponse;
import com.crewsafe.forecast.client.ModelCardApiClient.ShapDriver;
import com.crewsafe.forecast.service.ModelCardService.ModelCard;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ModelCardServiceTest {

    @Test
    void mapsTheClientResponseToTheBackendFacingCard() {
        ModelCardApiClient client = mock(ModelCardApiClient.class);
        HorizonCard horizonCard = new HorizonCard(
                List.of(new ShapDriver("wbgt_lag_15m", 0.42)),
                true,
                new Calibration(0.95, 0.9488, 68971),
                Map.of("BELOW_31", 0.33));
        ModelCardApiResponse apiResponse = new ModelCardApiResponse(
                "wbgt-six-month-frozen-candidate-v2:hist-gradient-leaves-31",
                Map.of("30", horizonCard));
        when(client.modelCard()).thenReturn(apiResponse);
        ModelCardService service = new ModelCardService(client);

        ModelCard card = service.currentCard();

        assertThat(card.modelVersion())
                .isEqualTo("wbgt-six-month-frozen-candidate-v2:hist-gradient-leaves-31");
        assertThat(card.horizons()).containsKey("30");
        assertThat(card.horizons().get("30").shapComputed()).isTrue();
        assertThat(card.horizons().get("30").shapDrivers()).hasSize(1);
        assertThat(card.horizons().get("30").shapDrivers().get(0).feature()).isEqualTo("wbgt_lag_15m");
        assertThat(card.horizons().get("30").calibration().finalTestCoverage()).isEqualTo(0.9488);
        assertThat(card.horizons().get("30").maeByActualBand()).isEqualTo(Map.of("BELOW_31", 0.33));
    }

    @Test
    void mapsANullCalibrationBlockToNull() {
        ModelCardApiClient client = mock(ModelCardApiClient.class);
        HorizonCard horizonCard = new HorizonCard(List.of(), false, null, Map.of());
        ModelCardApiResponse apiResponse = new ModelCardApiResponse(
                "baseline-1.0.0", Map.of("30", horizonCard));
        when(client.modelCard()).thenReturn(apiResponse);
        ModelCardService service = new ModelCardService(client);

        ModelCard card = service.currentCard();

        assertThat(card.horizons().get("30").calibration()).isNull();
        assertThat(card.horizons().get("30").shapComputed()).isFalse();
    }
}
