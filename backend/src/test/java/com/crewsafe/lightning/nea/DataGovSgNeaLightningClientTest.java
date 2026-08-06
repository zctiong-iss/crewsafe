package com.crewsafe.lightning.nea;

import com.crewsafe.weather.nea.NeaApiException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import java.time.Instant;

import static com.crewsafe.weather.nea.NeaApiException.Reason.HTTP;
import static com.crewsafe.weather.nea.NeaApiException.Reason.INVALID_RESPONSE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.ExpectedCount.once;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

/**
 * The response fixtures here mirror a live call confirmed against
 * {@code https://api-open.data.gov.sg/v2/real-time/api/weather?api=lightning} while scoping
 * SCRUM-170 — see {@link DataGovSgNeaLightningClient}'s class javadoc for how that shape was
 * obtained. The endpoint is not in data.gov.sg's public developer guide as of this writing.
 *
 * @author Jemilin Beulah
 */
class DataGovSgNeaLightningClientTest {

    private MockRestServiceServer server;
    private DataGovSgNeaLightningClient client;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder().baseUrl("https://data.gov.sg.test");
        server = MockRestServiceServer.bindTo(builder).build();
        client = new DataGovSgNeaLightningClient(builder.build());
    }

    @Test
    void mapsAStrikeBatchIntoTheStableObservationModel() {
        server.expect(once(), requestTo("https://data.gov.sg.test/weather?api=lightning"))
                .andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess("""
                        {
                          "code": 0,
                          "data": {
                            "records": [{
                              "datetime": "2026-08-06T07:44:00+08:00",
                              "item": {
                                "readings": [{
                                  "location": {"latitude": "1.4349", "longitude": "103.4280"},
                                  "type": "C",
                                  "text": "Cloud to Cloud",
                                  "datetime": "2026-08-06T07:43:26.243+08:00"
                                }],
                                "type": "observation",
                                "isStationData": false
                              },
                              "updatedTimestamp": "2026-08-06T07:46:02+08:00"
                            }]
                          },
                          "errorMsg": ""
                        }
                        """, MediaType.APPLICATION_JSON));

        NeaLightningObservation result = client.fetchLatest();

        assertThat(result.observedAt()).isEqualTo(Instant.parse("2026-08-05T23:44:00Z"));
        assertThat(result.simulated()).isFalse();
        assertThat(result.strikes()).singleElement().satisfies(strike -> {
            assertThat(strike.latitude()).isEqualByComparingTo("1.4349");
            assertThat(strike.longitude()).isEqualByComparingTo("103.4280");
            assertThat(strike.struckAt()).isEqualTo(Instant.parse("2026-08-05T23:43:26.243Z"));
            assertThat(strike.type()).isEqualTo("C");
        });
        server.verify();
    }

    @Test
    void anEmptyReadingsArrayIsAValidNoStrikeBatch() {
        server.expect(once(), requestTo("https://data.gov.sg.test/weather?api=lightning"))
                .andRespond(withSuccess("""
                        {
                          "code": 0,
                          "data": {
                            "records": [{
                              "datetime": "2026-08-06T07:44:00+08:00",
                              "item": {"readings": [], "type": "observation", "isStationData": false},
                              "updatedTimestamp": "2026-08-06T07:46:02+08:00"
                            }]
                          },
                          "errorMsg": ""
                        }
                        """, MediaType.APPLICATION_JSON));

        NeaLightningObservation result = client.fetchLatest();

        assertThat(result.strikes()).isEmpty();
        server.verify();
    }

    @Test
    void rejectsAnUpstreamErrorEnvelope() {
        server.expect(once(), requestTo("https://data.gov.sg.test/weather?api=lightning"))
                .andRespond(withSuccess("""
                        {"code": 17, "data": null, "errorMsg": "Data not found"}
                        """, MediaType.APPLICATION_JSON));

        assertThatThrownBy(() -> client.fetchLatest())
                .isInstanceOfSatisfying(NeaApiException.class, exception -> {
                    assertThat(exception.getReason()).isEqualTo(INVALID_RESPONSE);
                    assertThat(exception).hasMessageContaining("Data not found");
                });
        server.verify();
    }

    @Test
    void exposesHttpFailuresWithoutLeakingTheResponseBody() {
        server.expect(once(), requestTo("https://data.gov.sg.test/weather?api=lightning"))
                .andRespond(withServerError().body("upstream internals"));

        assertThatThrownBy(() -> client.fetchLatest())
                .isInstanceOfSatisfying(NeaApiException.class, exception -> {
                    assertThat(exception.getReason()).isEqualTo(HTTP);
                    assertThat(exception).hasMessageContaining("HTTP 500")
                            .hasMessageNotContaining("upstream internals");
                });
        server.verify();
    }
}
