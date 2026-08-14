package com.crewsafe.forecast.client;

import com.crewsafe.forecast.client.ForecastApiClient.ForecastApiRequest;
import com.crewsafe.forecast.client.ForecastApiClient.ForecastApiResponse;
import com.crewsafe.forecast.service.ForecastUnavailableException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.http.HttpMethod.POST;
import static org.springframework.test.web.client.ExpectedCount.once;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

class ForecastApiClientTest {

    private MockRestServiceServer server;
    private ForecastApiClient client;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder().baseUrl("http://forecast.test");
        server = MockRestServiceServer.bindTo(builder).build();
        client = new ForecastApiClient(builder.build());
    }

    @Test
    void sendsAndReadsTheCommittedSnakeCaseContract() {
        server.expect(once(), requestTo("http://forecast.test/forecast"))
                .andExpect(method(POST))
                .andExpect(content().json("""
                        {
                          "metric": "wbgt",
                          "horizon_minutes": 30,
                          "current_value": 31.5,
                          "context": null
                        }
                        """))
                .andRespond(withSuccess("""
                        {
                          "metric": "wbgt",
                          "predicted_value": 31.8,
                          "horizon_minutes": 30,
                          "model_version": "wbgt-v2:hist-gradient",
                          "confidence_interval_lower": 30.8,
                          "confidence_interval_upper": 32.8,
                          "timestamp": "2026-08-14T04:00:00Z"
                        }
                        """, MediaType.APPLICATION_JSON));

        ForecastApiResponse response = client.forecast(
                ForecastApiRequest.wbgt(30, new BigDecimal("31.5"), null));

        assertThat(response.predictedValue()).isEqualByComparingTo("31.8");
        assertThat(response.modelVersion()).isEqualTo("wbgt-v2:hist-gradient");
        server.verify();
    }

    @Test
    void rejectsAResponseThatDoesNotMatchTheRequest() {
        server.expect(requestTo("http://forecast.test/forecast"))
                .andRespond(withSuccess("""
                        {
                          "metric": "wbgt",
                          "predicted_value": 31.8,
                          "horizon_minutes": 60,
                          "model_version": "wrong-horizon",
                          "confidence_interval_lower": 30.8,
                          "confidence_interval_upper": 32.8,
                          "timestamp": "2026-08-14T04:00:00Z"
                        }
                        """, MediaType.APPLICATION_JSON));

        assertThatThrownBy(() -> client.forecast(
                ForecastApiRequest.wbgt(30, new BigDecimal("31.5"), null)))
                .isInstanceOf(ForecastUnavailableException.class)
                .hasMessage("Forecast service returned an invalid contract");
    }

    @Test
    void translatesAnHttpFailureToTheTypedServiceBoundaryError() {
        server.expect(requestTo("http://forecast.test/forecast"))
                .andRespond(withServerError());

        assertThatThrownBy(() -> client.forecast(
                ForecastApiRequest.wbgt(30, new BigDecimal("31.5"), null)))
                .isInstanceOf(ForecastUnavailableException.class)
                .hasMessage("Forecast service request failed");
    }
}
