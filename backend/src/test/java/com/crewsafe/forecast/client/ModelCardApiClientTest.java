package com.crewsafe.forecast.client;

import com.crewsafe.forecast.client.ModelCardApiClient.ModelCardApiResponse;
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

class ModelCardApiClientTest {

    private MockRestServiceServer server;
    private ModelCardApiClient client;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder().baseUrl("http://forecast.test");
        server = MockRestServiceServer.bindTo(builder).build();
        client = new ModelCardApiClient(builder.build());
    }

    @Test
    void sendsAndReadsTheCommittedSnakeCaseContract() {
        server.expect(once(), requestTo("http://forecast.test/model/card"))
                .andExpect(method(GET))
                .andRespond(withSuccess("""
                        {
                          "model_version": "wbgt-six-month-frozen-candidate-v2:hist-gradient-leaves-31",
                          "horizons": {
                            "30": {
                              "shap_drivers": [
                                {"feature": "wbgt_lag_15m", "mean_abs_shap": 0.42}
                              ],
                              "shap_computed": true,
                              "calibration": {
                                "target_coverage": 0.95,
                                "final_test_coverage": 0.9488,
                                "calibration_sample_count": 68971
                              },
                              "mae_by_actual_band": {"BELOW_31": 0.33, "AT_LEAST_33": 1.66}
                            }
                          }
                        }
                        """, MediaType.APPLICATION_JSON));

        ModelCardApiResponse response = client.modelCard();

        assertThat(response.modelVersion())
                .isEqualTo("wbgt-six-month-frozen-candidate-v2:hist-gradient-leaves-31");
        assertThat(response.horizons()).containsKey("30");
        assertThat(response.horizons().get("30").shapComputed()).isTrue();
        assertThat(response.horizons().get("30").shapDrivers()).hasSize(1);
        assertThat(response.horizons().get("30").calibration().finalTestCoverage()).isEqualTo(0.9488);
        server.verify();
    }

    @Test
    void toleratesANullCalibrationBlock() {
        server.expect(requestTo("http://forecast.test/model/card"))
                .andRespond(withSuccess("""
                        {
                          "model_version": "baseline-1.0.0",
                          "horizons": {
                            "30": {
                              "shap_drivers": [],
                              "shap_computed": false,
                              "calibration": null,
                              "mae_by_actual_band": {}
                            }
                          }
                        }
                        """, MediaType.APPLICATION_JSON));

        ModelCardApiResponse response = client.modelCard();

        assertThat(response.horizons().get("30").calibration()).isNull();
    }

    @Test
    void rejectsAResponseMissingAModelVersion() {
        server.expect(requestTo("http://forecast.test/model/card"))
                .andRespond(withSuccess("""
                        {
                          "model_version": "",
                          "horizons": {}
                        }
                        """, MediaType.APPLICATION_JSON));

        assertThatThrownBy(client::modelCard)
                .isInstanceOf(ForecastUnavailableException.class)
                .hasMessage("Model card service returned an invalid contract");
    }

    @Test
    void translatesAnHttpFailureToTheTypedServiceBoundaryError() {
        server.expect(requestTo("http://forecast.test/model/card"))
                .andRespond(withServerError());

        assertThatThrownBy(client::modelCard)
                .isInstanceOf(ForecastUnavailableException.class)
                .hasMessage("Model card service request failed");
    }
}
