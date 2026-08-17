package com.crewsafe.forecast.api;

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
        ModelStatusService service = mock(ModelStatusService.class);
        ModelStatusController controller = new ModelStatusController(service);
        ModelStatus status = new ModelStatus(
                "baseline-1.0.0", false, "no model configured", Map.of());
        when(service.currentStatus()).thenReturn(status);

        var response = controller.getModelStatus();

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isEqualTo(status);
    }

    @Test
    void isRestrictedToSafetyManagers() throws NoSuchMethodException {
        PreAuthorize authorization = ModelStatusController.class
                .getMethod("getModelStatus")
                .getAnnotation(PreAuthorize.class);

        assertThat(authorization).isNotNull();
        assertThat(authorization.value()).isEqualTo("hasRole('SAFETY_MANAGER')");
    }
}
