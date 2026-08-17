package com.crewsafe.forecast.client;

import com.crewsafe.forecast.client.ModelStatusApiClient.ModelStatusApiResponse;
import com.crewsafe.forecast.service.ForecastUnavailableException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.http.HttpMethod.GET;
import static org.springframework.test.web.client.ExpectedCount.once;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

class ModelStatusApiClientTest {

    private MockRestServiceServer server;
    private ModelStatusApiClient client;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder().baseUrl("http://forecast.test");
        server = MockRestServiceServer.bindTo(builder).build();
        client = new ModelStatusApiClient(builder.build());
    }

    @Test
    void sendsAndReadsTheCommittedSnakeCaseContract() {
        server.expect(once(), requestTo("http://forecast.test/model/status"))
                .andExpect(method(GET))
                .andRespond(withSuccess("""
                        {
                          "model_version": "wbgt-six-month-frozen-candidate-v2:hist-gradient-leaves-31",
                          "approved_for_inference": false,
                          "approval_blocker": "A newer untouched evaluation period is required.",
                          "horizons": {
                            "30": {
                              "mae": 0.36,
                              "rmse": 0.61,
                              "mean_bias": 0.04,
                              "macro_f1": 0.36,
                              "recall_at_least_32": 0.22,
                              "recall_at_least_33": 0.03,
                              "mae_by_actual_band": {"BELOW_31": 0.33, "AT_LEAST_33": 1.66},
                              "confusion_matrix": [[1, 0], [0, 1]],
                              "sample_count": 67335
                            }
                          }
                        }
                        """, MediaType.APPLICATION_JSON));

        ModelStatusApiResponse response = client.modelStatus();

        assertThat(response.modelVersion())
                .isEqualTo("wbgt-six-month-frozen-candidate-v2:hist-gradient-leaves-31");
        assertThat(response.approvedForInference()).isFalse();
        assertThat(response.approvalBlocker()).isEqualTo("A newer untouched evaluation period is required.");
        assertThat(response.horizons()).containsKey("30");
        assertThat(response.horizons().get("30").sampleCount()).isEqualTo(67335);
        server.verify();
    }

    @Test
    void rejectsAResponseMissingAModelVersion() {
        server.expect(requestTo("http://forecast.test/model/status"))
                .andRespond(withSuccess("""
                        {
                          "model_version": "",
                          "approved_for_inference": false,
                          "approval_blocker": null,
                          "horizons": {}
                        }
                        """, MediaType.APPLICATION_JSON));

        assertThatThrownBy(client::modelStatus)
                .isInstanceOf(ForecastUnavailableException.class)
                .hasMessage("Model status service returned an invalid contract");
    }

    @Test
    void translatesAnHttpFailureToTheTypedServiceBoundaryError() {
        server.expect(requestTo("http://forecast.test/model/status"))
                .andRespond(withServerError());

        assertThatThrownBy(client::modelStatus)
                .isInstanceOf(ForecastUnavailableException.class)
                .hasMessage("Model status service request failed");
    }
}
