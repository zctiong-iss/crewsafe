package com.crewsafe.weather.nea;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;

import static com.crewsafe.weather.nea.NeaApiException.Reason.HTTP;
import static com.crewsafe.weather.nea.NeaApiException.Reason.INVALID_RESPONSE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.ExpectedCount.once;
import static org.springframework.test.web.client.ExpectedCount.times;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

class DataGovSgNeaWeatherClientTest {

    private MockRestServiceServer server;
    private DataGovSgNeaWeatherClient client;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder().baseUrl("https://data.gov.sg.test");
        server = MockRestServiceServer.bindTo(builder).build();
        client = new DataGovSgNeaWeatherClient(builder.build(), retryProperties());
    }

    @Test
    void mapsCurrentWbgtResponseIntoStableObservationModel() {
        server.expect(once(), requestTo("https://data.gov.sg.test/weather?api=wbgt"))
                .andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess("""
                        {
                          "code": 0,
                          "data": {
                            "records": [{
                              "datetime": "2026-07-29T15:30:00+08:00",
                              "item": {
                                "isStationData": true,
                                "type": "observation",
                                "readings": [{
                                  "station": {
                                    "id": "S124",
                                    "name": "Upper Changi Road North",
                                    "townCenter": "Changi Meteorological Station"
                                  },
                                  "location": {
                                    "latitude": "1.36777",
                                    "longitude": "103.982262"
                                  },
                                  "wbgt": "27.5",
                                  "heatStress": "Low"
                                }]
                              },
                              "updatedTimestamp": "2026-07-29T15:40:04+08:00"
                            }]
                          },
                          "errorMsg": ""
                        }
                        """, MediaType.APPLICATION_JSON));

        NeaObservation result = client.fetch(NeaMetric.WBGT);

        assertThat(result.metric()).isEqualTo(NeaMetric.WBGT);
        assertThat(result.observedAt()).isEqualTo(Instant.parse("2026-07-29T07:30:00Z"));
        assertThat(result.unit()).isEqualTo("deg C");
        assertThat(result.readings()).singleElement().satisfies(reading -> {
            assertThat(reading.station().id()).isEqualTo("S124");
            assertThat(reading.station().name()).isEqualTo("Upper Changi Road North");
            assertThat(reading.station().latitude()).isEqualByComparingTo("1.36777");
            assertThat(reading.station().longitude()).isEqualByComparingTo("103.982262");
            assertThat(reading.value()).isEqualByComparingTo("27.5");
            assertThat(reading.heatStress()).isEqualTo("Low");
        });
        server.verify();
    }

    /**
     * The regression this whole path exists for. data.gov.sg sends "NA" for a station that is
     * online but has no reading this interval. The DTO typed wbgt as BigDecimal, so Jackson threw
     * partway through the payload and the entire response was discarded - one offline station
     * destroyed every other station's reading, every cycle it happened, which is what left the
     * WBGT history too sparse for the forecast's context window to assemble.
     */
    @Test
    void keepsReportingStationsWhenOneReportsNoValue() {
        server.expect(once(), requestTo("https://data.gov.sg.test/weather?api=wbgt"))
                .andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess(wbgtResponseWith("""
                        {
                          "station": {"id": "S124", "name": "Upper Changi Road North"},
                          "location": {"latitude": "1.36777", "longitude": "103.982262"},
                          "wbgt": "27.5",
                          "heatStress": "Low"
                        },
                        {
                          "station": {"id": "S999", "name": "Offline Station"},
                          "location": {"latitude": "1.4", "longitude": "103.8"},
                          "wbgt": "NA",
                          "heatStress": "NA"
                        }
                        """), MediaType.APPLICATION_JSON));

        NeaObservation result = client.fetch(NeaMetric.WBGT);

        assertThat(result.readings()).singleElement().satisfies(reading -> {
            assertThat(reading.station().id()).isEqualTo("S124");
            assertThat(reading.value()).isEqualByComparingTo("27.5");
        });
        server.verify();
    }

    /** Empty strings and dashes are the same "no reading" state under a different spelling. */
    @Test
    void treatsOtherAbsentValuePlaceholdersAsNoReading() {
        server.expect(once(), requestTo("https://data.gov.sg.test/weather?api=wbgt"))
                .andRespond(withSuccess(wbgtResponseWith("""
                        {
                          "station": {"id": "S124", "name": "Upper Changi Road North"},
                          "location": {"latitude": "1.36777", "longitude": "103.982262"},
                          "wbgt": "27.5"
                        },
                        {
                          "station": {"id": "S998", "name": "Dash Station"},
                          "location": {"latitude": "1.4", "longitude": "103.8"},
                          "wbgt": "-"
                        },
                        {
                          "station": {"id": "S997", "name": "Blank Station"},
                          "location": {"latitude": "1.4", "longitude": "103.8"},
                          "wbgt": ""
                        }
                        """), MediaType.APPLICATION_JSON));

        assertThat(client.fetch(NeaMetric.WBGT).readings()).hasSize(1);
        server.verify();
    }

    /**
     * Lenient about missing, never about malformed. A value that is neither a number nor a known
     * placeholder means the upstream format moved, and reading it as "no data" would turn a
     * contract break into a slow invisible gap in safety readings.
     */
    @Test
    void stillRejectsAReadingThatIsNeitherNumberNorKnownPlaceholder() {
        server.expect(once(), requestTo("https://data.gov.sg.test/weather?api=wbgt"))
                .andRespond(withSuccess(wbgtResponseWith("""
                        {
                          "station": {"id": "S124", "name": "Upper Changi Road North"},
                          "location": {"latitude": "1.36777", "longitude": "103.982262"},
                          "wbgt": "27.5 degrees"
                        }
                        """), MediaType.APPLICATION_JSON));

        assertThatThrownBy(() -> client.fetch(NeaMetric.WBGT))
                .isInstanceOfSatisfying(NeaApiException.class,
                        exception -> assertThat(exception.getReason()).isEqualTo(INVALID_RESPONSE));
        server.verify();
    }

    /** Every station silent is not an observation - there is genuinely nothing to ingest. */
    @Test
    void rejectsAResponseInWhichNoStationHasAReading() {
        server.expect(once(), requestTo("https://data.gov.sg.test/weather?api=wbgt"))
                .andRespond(withSuccess(wbgtResponseWith("""
                        {
                          "station": {"id": "S124", "name": "Upper Changi Road North"},
                          "location": {"latitude": "1.36777", "longitude": "103.982262"},
                          "wbgt": "NA"
                        }
                        """), MediaType.APPLICATION_JSON));

        assertThatThrownBy(() -> client.fetch(NeaMetric.WBGT))
                .isInstanceOfSatisfying(NeaApiException.class, exception -> {
                    assertThat(exception.getReason()).isEqualTo(INVALID_RESPONSE);
                    assertThat(exception).hasMessageContaining("no station with a usable reading");
                });
        server.verify();
    }

    /**
     * A station that cannot be attributed or located is malformed rather than incomplete, so it
     * still fails the batch - unchanged by the leniency above.
     */
    @Test
    void stillRejectsAWbgtStationMissingItsCoordinates() {
        server.expect(once(), requestTo("https://data.gov.sg.test/weather?api=wbgt"))
                .andRespond(withSuccess(wbgtResponseWith("""
                        {
                          "station": {"id": "S124", "name": "Upper Changi Road North"},
                          "location": {"latitude": null, "longitude": "103.982262"},
                          "wbgt": "27.5"
                        }
                        """), MediaType.APPLICATION_JSON));

        assertThatThrownBy(() -> client.fetch(NeaMetric.WBGT))
                .isInstanceOfSatisfying(NeaApiException.class, exception -> {
                    assertThat(exception.getReason()).isEqualTo(INVALID_RESPONSE);
                    assertThat(exception).hasMessageContaining("incomplete station reading");
                });
        server.verify();
    }

    /** Wraps station readings in the WBGT envelope so each test states only what it varies. */
    private static String wbgtResponseWith(String readingsJson) {
        return """
                {
                  "code": 0,
                  "data": {
                    "records": [{
                      "datetime": "2026-07-29T15:30:00+08:00",
                      "item": {"isStationData": true, "type": "observation", "readings": [%s]},
                      "updatedTimestamp": "2026-07-29T15:40:04+08:00"
                    }]
                  },
                  "errorMsg": ""
                }
                """.formatted(readingsJson);
    }

    @Test
    void mapsStandardWeatherResponseAndJoinsReadingToStationMetadata() {
        server.expect(once(), requestTo("https://data.gov.sg.test/air-temperature"))
                .andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess(standardTemperatureResponse(), MediaType.APPLICATION_JSON));

        NeaObservation result = client.fetch(NeaMetric.AIR_TEMPERATURE);

        assertThat(result.metric()).isEqualTo(NeaMetric.AIR_TEMPERATURE);
        assertThat(result.observedAt()).isEqualTo(Instant.parse("2026-07-30T00:29:00Z"));
        assertThat(result.unit()).isEqualTo("deg C");
        assertThat(result.readings()).singleElement().satisfies(reading -> {
            assertThat(reading.station().id()).isEqualTo("S109");
            assertThat(reading.station().latitude()).isEqualByComparingTo(new BigDecimal("1.3793"));
            assertThat(reading.value()).isEqualByComparingTo("28.8");
            assertThat(reading.heatStress()).isNull();
        });
        server.verify();
    }

    @Test
    void rejectsAnUpstreamErrorEnvelope() {
        server.expect(once(), requestTo("https://data.gov.sg.test/rainfall"))
                .andRespond(withSuccess("""
                        {"code": 17, "data": null, "errorMsg": "Weather data not found"}
                        """, MediaType.APPLICATION_JSON));

        assertThatThrownBy(() -> client.fetch(NeaMetric.RAINFALL))
                .isInstanceOfSatisfying(NeaApiException.class, exception -> {
                    assertThat(exception.getReason()).isEqualTo(INVALID_RESPONSE);
                    assertThat(exception).hasMessageContaining("Weather data not found");
                });
        server.verify();
    }

    @Test
    void rejectsAReadingWhoseStationMetadataIsMissing() {
        server.expect(once(), requestTo("https://data.gov.sg.test/wind-speed"))
                .andRespond(withSuccess("""
                        {
                          "code": 0,
                          "data": {
                            "stations": [{
                              "id": "S108",
                              "name": "Marina Gardens Drive",
                              "location": {"latitude": 1.2799, "longitude": 103.8703}
                            }],
                            "readings": [{
                              "timestamp": "2026-07-30T08:34:00+08:00",
                              "data": [{"stationId": "UNKNOWN", "value": 2.3}]
                            }],
                            "readingUnit": "knots"
                          },
                          "errorMsg": ""
                        }
                        """, MediaType.APPLICATION_JSON));

        assertThatThrownBy(() -> client.fetch(NeaMetric.WIND_SPEED))
                .isInstanceOfSatisfying(NeaApiException.class, exception -> {
                    assertThat(exception.getReason()).isEqualTo(INVALID_RESPONSE);
                    assertThat(exception).hasMessageContaining("unknown station UNKNOWN");
                });
        server.verify();
    }

    @Test
    void exposesHttpFailuresWithoutLeakingTheResponseBody() {
        server.expect(times(3), requestTo("https://data.gov.sg.test/relative-humidity"))
                .andRespond(withServerError().body("upstream internals"));

        assertThatThrownBy(() -> client.fetch(NeaMetric.RELATIVE_HUMIDITY))
                .isInstanceOfSatisfying(NeaApiException.class, exception -> {
                    assertThat(exception.getReason()).isEqualTo(HTTP);
                    assertThat(exception).hasMessageContaining("HTTP 500")
                            .hasMessageNotContaining("upstream internals");
                });
        server.verify();
    }

    @Test
    void retriesTemporaryServerFailureAndReturnsTheNextSuccessfulResponse() {
        server.expect(once(), requestTo("https://data.gov.sg.test/air-temperature"))
                .andRespond(withServerError());
        server.expect(once(), requestTo("https://data.gov.sg.test/air-temperature"))
                .andRespond(withSuccess(standardTemperatureResponse(), MediaType.APPLICATION_JSON));

        NeaObservation result = client.fetch(NeaMetric.AIR_TEMPERATURE);

        assertThat(result.readings()).singleElement()
                .satisfies(reading -> assertThat(reading.value()).isEqualByComparingTo("28.8"));
        server.verify();
    }

    @Test
    void doesNotRetryAClientError() {
        server.expect(once(), requestTo("https://data.gov.sg.test/rainfall"))
                .andRespond(withStatus(HttpStatus.BAD_REQUEST));

        assertThatThrownBy(() -> client.fetch(NeaMetric.RAINFALL))
                .isInstanceOfSatisfying(NeaApiException.class,
                        exception -> assertThat(exception.getReason()).isEqualTo(HTTP));
        server.verify();
    }

    /*
     * SCRUM-114 follow-up. Anonymous callers get 429 from data.gov.sg with "try again in 10
     * seconds". The exponential curve tops out at max-backoff, so before this the three
     * attempts all landed inside the penalty window and weather ingestion failed every single
     * cycle while lightning — one call rather than five — kept succeeding beside it.
     */
    @Test
    void waitsTheRateLimitBackoffRatherThanTheExponentialCurveOnA429() {
        server.expect(once(), requestTo("https://data.gov.sg.test/rainfall"))
                .andRespond(withStatus(HttpStatus.TOO_MANY_REQUESTS));
        server.expect(once(), requestTo("https://data.gov.sg.test/rainfall"))
                .andRespond(withSuccess(standardTemperatureResponse(), MediaType.APPLICATION_JSON));

        Instant start = Instant.now();
        NeaObservation result = client.fetch(NeaMetric.RAINFALL);
        Duration waited = Duration.between(start, Instant.now());

        assertThat(result.readings()).isNotEmpty();
        // The 50ms rate-limit backoff, not the 1ms initial backoff: proves the 429 took the
        // dedicated path rather than the curve that could never outlast a real penalty.
        assertThat(waited).isGreaterThanOrEqualTo(Duration.ofMillis(50));
        server.verify();
    }

    @Test
    void prefersTheServersRetryAfterOverTheConfiguredDefault() {
        server.expect(once(), requestTo("https://data.gov.sg.test/rainfall"))
                .andRespond(withStatus(HttpStatus.TOO_MANY_REQUESTS)
                        .header(HttpHeaders.RETRY_AFTER, "1"));
        server.expect(once(), requestTo("https://data.gov.sg.test/rainfall"))
                .andRespond(withSuccess(standardTemperatureResponse(), MediaType.APPLICATION_JSON));

        Instant start = Instant.now();
        client.fetch(NeaMetric.RAINFALL);
        Duration waited = Duration.between(start, Instant.now());

        // A full second, well past the configured 50ms: the server knows its own window, so
        // when it states one we obey it rather than our own guess.
        assertThat(waited).isGreaterThanOrEqualTo(Duration.ofSeconds(1));
        server.verify();
    }

    @Test
    void healthReachabilityUsesTheRequestedSingleAttempt() {
        server.expect(once(), requestTo("https://data.gov.sg.test/weather?api=wbgt"))
                .andRespond(withServerError());

        assertThatThrownBy(() -> client.checkReachability(1))
                .isInstanceOfSatisfying(NeaApiException.class,
                        exception -> assertThat(exception.getReason()).isEqualTo(
                                NeaApiException.Reason.HTTP));
        server.verify();
    }

    private NeaApiProperties retryProperties() {
        NeaApiProperties properties = new NeaApiProperties();
        properties.setMaxAttempts(3);
        properties.setInitialBackoff(Duration.ofMillis(1));
        properties.setMaxBackoff(Duration.ofMillis(2));
        // Set explicitly, not left at the 12s production default, or every rate-limit test
        // below would really sleep twelve seconds each.
        properties.setRateLimitBackoff(Duration.ofMillis(50));
        return properties;
    }

    private String standardTemperatureResponse() {
        return """
                {
                  "code": 0,
                  "data": {
                    "stations": [{
                      "id": "S109",
                      "name": "Ang Mo Kio Avenue 5",
                      "location": {"latitude": 1.3793, "longitude": 103.85}
                    }],
                    "readings": [{
                      "timestamp": "2026-07-30T08:29:00+08:00",
                      "data": [{"stationId": "S109", "value": 28.8}]
                    }],
                    "readingUnit": "deg C"
                  },
                  "errorMsg": ""
                }
                """;
    }
}
