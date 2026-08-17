package com.crewsafe.forecast.api;

import com.crewsafe.forecast.service.ModelCardService;
import com.crewsafe.forecast.service.ModelCardService.ModelCard;
import com.crewsafe.forecast.service.ModelStatusService;
import com.crewsafe.forecast.service.ModelStatusService.ModelStatus;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ModelStatusControllerTest {

    @Test
    void returnsTheServiceStatus() {
        ModelStatusService statusService = mock(ModelStatusService.class);
        ModelCardService cardService = mock(ModelCardService.class);
        ModelStatusController controller = new ModelStatusController(statusService, cardService);
        ModelStatus status = new ModelStatus(
                "baseline-1.0.0", false, "no model configured", Map.of());
        when(statusService.currentStatus()).thenReturn(status);

        var response = controller.getModelStatus();

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isEqualTo(status);
    }

    @Test
    void returnsTheServiceCard() {
        ModelStatusService statusService = mock(ModelStatusService.class);
        ModelCardService cardService = mock(ModelCardService.class);
        ModelStatusController controller = new ModelStatusController(statusService, cardService);
        ModelCard card = new ModelCard("baseline-1.0.0", Map.of());
        when(cardService.currentCard()).thenReturn(card);

        var response = controller.getModelCard();

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isEqualTo(card);
    }

    @Test
    void isRestrictedToSafetyManagers() throws NoSuchMethodException {
        PreAuthorize statusAuthorization = ModelStatusController.class
                .getMethod("getModelStatus")
                .getAnnotation(PreAuthorize.class);
        PreAuthorize cardAuthorization = ModelStatusController.class
                .getMethod("getModelCard")
                .getAnnotation(PreAuthorize.class);

        assertThat(statusAuthorization).isNotNull();
        assertThat(statusAuthorization.value()).isEqualTo("hasRole('SAFETY_MANAGER')");
        assertThat(cardAuthorization).isNotNull();
        assertThat(cardAuthorization.value()).isEqualTo("hasRole('SAFETY_MANAGER')");
    }
}
