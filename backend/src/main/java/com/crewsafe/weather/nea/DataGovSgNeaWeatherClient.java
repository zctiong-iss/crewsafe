package com.crewsafe.weather.nea;

import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.http.HttpHeaders;
import org.springframework.web.client.RestClientResponseException;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.function.Supplier;

import static com.crewsafe.weather.nea.NeaApiException.Reason.HTTP;
import static com.crewsafe.weather.nea.NeaApiException.Reason.INVALID_RESPONSE;
import static com.crewsafe.weather.nea.NeaApiException.Reason.TRANSPORT;

/**
 * Adapter for the current data.gov.sg real-time WBGT and weather response formats.
 *
 * <p>WBGT is served by the unified {@code /weather?api=wbgt} endpoint and has a different
 * JSON shape from the other station APIs. Both shapes are normalised into
 * {@link NeaObservation} here so no upstream DTO leaks into the rest of CrewSafe.
 * The complete endpoint inventory and local run instructions live in
 * {@code docs/runbooks/SCRUM-111-weather-ingestion.md}.
 *
 * @author Bryan Phang
 * @author Justin Chua
 */
@Component
@ConditionalOnProperty(prefix = "app.weather.data", name = "mode", havingValue = "live",
        matchIfMissing = true)
@RequiredArgsConstructor
@Slf4j
public class DataGovSgNeaWeatherClient implements NeaWeatherClient {

    /** Named once so every failure message says where the reading was meant to come from. */
    private static final String DATA_SOURCE_NAME = "data.gov.sg";

    private static final String WBGT_ENDPOINT_PATH = "/weather";
    private static final String DATASET_QUERY_PARAMETER = "api";
    private static final String WBGT_DATASET_NAME = "wbgt";

    private static final Map<NeaMetric, String> STANDARD_WEATHER_ENDPOINT_PATHS = Map.of(
            NeaMetric.AIR_TEMPERATURE, "/air-temperature",
            NeaMetric.RELATIVE_HUMIDITY, "/relative-humidity",
            NeaMetric.WIND_SPEED, "/wind-speed",
            NeaMetric.RAINFALL, "/rainfall"
    );

    private final RestClient neaRestClient;
    private final NeaApiProperties properties;

    @Override
    public NeaObservation fetch(NeaMetric metric) {
        if (metric == null) {
            throw new IllegalArgumentException("metric is required");
        }
        if (metric == NeaMetric.WBGT) {
            return fetchWbgt();
        }

        String endpointPath = STANDARD_WEATHER_ENDPOINT_PATHS.get(metric);
        if (endpointPath == null) {
            throw new IllegalArgumentException("Unsupported NEA metric: " + metric);
        }
        return fetchStandardWeather(metric, endpointPath);
    }

    @Override
    public void checkReachability(int maxAttempts) {
        fetchWbgt(Math.max(1, maxAttempts));
    }

    private NeaObservation fetchWbgt() {
        return fetchWbgt(properties.getMaxAttempts());
    }

    private NeaObservation fetchWbgt(int maxAttempts) {
        WbgtResponse response = execute("WBGT", maxAttempts, () -> neaRestClient.get()
                .uri(uriBuilder -> uriBuilder.path(WBGT_ENDPOINT_PATH)
                        .queryParam(DATASET_QUERY_PARAMETER, WBGT_DATASET_NAME)
                        .build())
                .retrieve()
                .body(WbgtResponse.class));
        validateEnvelope("WBGT", response == null ? null : response.code(),
                response == null ? null : response.errorMsg());

        List<WbgtRecord> records = requireNonEmpty(
                response.data() == null ? null : response.data().records(), "WBGT records");
        if (records.stream().anyMatch(record -> record == null || record.datetime() == null
                || record.item() == null)) {
            throw invalid("WBGT response contains a record missing datetime or item");
        }
        WbgtRecord record = records.stream()
                .max(Comparator.comparing(WbgtRecord::datetime))
                .orElseThrow();

        List<WbgtReading> reported = requireNonEmpty(record.item().readings(), "WBGT readings");
        List<NeaStationReading> readings = reported.stream()
                .map(this::mapWbgtReading)
                .filter(Objects::nonNull)
                .toList();

        // A station reporting no value is normal; every station reporting none is not, and there
        // is nothing to ingest from it. Failing here rather than returning an empty observation
        // keeps "we received nothing usable" distinguishable from "conditions were unremarkable".
        if (readings.isEmpty()) {
            throw invalid("WBGT response contained no station with a usable reading");
        }
        int skipped = reported.size() - readings.size();
        if (skipped > 0) {
            // Count only. Station identifiers are third-party input and this reaches the log sink.
            log.info("nea_wbgt_stations_without_reading skipped={} used={}", skipped, readings.size());
        }
        return new NeaObservation(NeaMetric.WBGT, record.datetime().toInstant(), "deg C", readings);
    }

    /**
     * Maps one station's WBGT reading, or null if that station has no reading to report.
     *
     * <p>The null return is the whole point. data.gov.sg sends {@code "NA"} for a station that is
     * online but has nothing for this interval, and both layers that met it used to destroy the
     * entire batch: the DTO's strict {@link BigDecimal} mapping threw during deserialization, and
     * this method threw again on a null value. One offline station out of twenty discarded the
     * other nineteen, every cycle it happened — which is what left the WBGT history too sparse
     * and too gappy for the forecast's context window to assemble.
     *
     * <p>Structural problems still throw. A station with no id, no name or no coordinates is a
     * malformed record rather than an incomplete one: it cannot be attributed or located, so
     * accepting it would put an unusable reading into the safety record. The distinction is
     * between a station that did not answer and a response that no longer matches the contract.
     */
    private NeaStationReading mapWbgtReading(WbgtReading reading) {
        if (reading == null || reading.station() == null || reading.location() == null
                || !StringUtils.hasText(reading.station().id())
                || !StringUtils.hasText(reading.station().name())
                || reading.location().latitude() == null || reading.location().longitude() == null) {
            throw invalid("WBGT response contains an incomplete station reading");
        }
        if (reading.wbgt() == null) {
            return null;
        }
        NeaStation station = new NeaStation(
                reading.station().id(),
                reading.station().name(),
                reading.location().latitude(),
                reading.location().longitude());
        return new NeaStationReading(station, reading.wbgt(), reading.heatStress());
    }

    private NeaObservation fetchStandardWeather(NeaMetric metric, String endpointPath) {
        StandardResponse response = execute(metric.name(), properties.getMaxAttempts(), () -> neaRestClient.get()
                .uri(endpointPath)
                .retrieve()
                .body(StandardResponse.class));
        validateEnvelope(metric.name(), response == null ? null : response.code(),
                response == null ? null : response.errorMsg());

        StandardData data = response.data();
        if (data == null || !StringUtils.hasText(data.readingUnit())) {
            throw invalid(metric + " response is missing data or reading unit");
        }

        Map<String, NeaStation> stations = mapStations(data.stations(), metric);
        List<StandardReadingBatch> batches = requireNonEmpty(
                data.readings(), metric + " reading batches");
        if (batches.stream().anyMatch(batch -> batch == null || batch.timestamp() == null)) {
            throw invalid(metric + " response contains a reading batch missing its timestamp");
        }
        StandardReadingBatch batch = batches.stream()
                .max(Comparator.comparing(StandardReadingBatch::timestamp))
                .orElseThrow();

        List<NeaStationReading> readings = requireNonEmpty(batch.data(), metric + " readings")
                .stream()
                .map(reading -> mapStandardReading(metric, reading, stations))
                .toList();
        return new NeaObservation(metric, batch.timestamp().toInstant(), data.readingUnit(), readings);
    }

    private Map<String, NeaStation> mapStations(List<StandardStation> stationDtos, NeaMetric metric) {
        Map<String, NeaStation> stations = new LinkedHashMap<>();
        for (StandardStation station : requireNonEmpty(stationDtos, metric + " stations")) {
            if (station == null || !StringUtils.hasText(station.id())
                    || !StringUtils.hasText(station.name()) || station.location() == null
                    || station.location().latitude() == null || station.location().longitude() == null) {
                throw invalid(metric + " response contains incomplete station metadata");
            }
            NeaStation previous = stations.put(station.id(), new NeaStation(
                    station.id(), station.name(), station.location().latitude(),
                    station.location().longitude()));
            if (previous != null) {
                throw invalid(metric + " response contains duplicate station id " + station.id());
            }
        }
        return stations;
    }

    private NeaStationReading mapStandardReading(NeaMetric metric, StandardReading reading,
                                                  Map<String, NeaStation> stations) {
        if (reading == null || !StringUtils.hasText(reading.stationId()) || reading.value() == null) {
            throw invalid(metric + " response contains an incomplete reading");
        }
        NeaStation station = stations.get(reading.stationId());
        if (station == null) {
            throw invalid(metric + " reading references unknown station " + reading.stationId());
        }
        return new NeaStationReading(station, reading.value(), null);
    }

    private <T> T execute(String operation, Supplier<T> request) {
        return execute(operation, properties.getMaxAttempts(), request);
    }

    private <T> T execute(String operation, int maxAttempts, Supplier<T> request) {
        Duration backoff = properties.getInitialBackoff();
        int attempts = Math.max(1, maxAttempts);
        for (int attempt = 1; attempt <= attempts; attempt++) {
            try {
                return request.get();
            } catch (RestClientException exception) {
                NeaApiException failure = translateFailure(operation, exception);
                if (!isRetryable(exception) || attempt == attempts) {
                    throw failure;
                }

                // A rate limit is not a transient blip and does not answer to the same curve.
                // The server states when it will serve us again; obeying that beats doubling
                // 250ms three times inside a ten-second penalty and calling it a retry.
                Duration wait = rateLimitWait(exception).orElse(backoff);

                // `failure` carries the translated kind (HTTP status, transport, or decode);
                // logging only the attempt number makes a 429, a connection reset and a
                // malformed payload indistinguishable in the one place they can be told apart.
                log.warn("data.gov.sg {} attempt {}/{} failed; retrying after {}",
                        operation, attempt, attempts, wait, failure);
                waitBeforeRetry(operation, wait);
                backoff = nextBackoff(backoff);
            }
        }
        throw new IllegalStateException("NEA retry loop completed without a result");
    }

    /**
     * Opens every failure message the same way, e.g. {@code "data.gov.sg wbgt "}, so a reader
     * sees the source and the failing operation before the reason.
     */
    private static String failurePrefix(String operation) {
        return DATA_SOURCE_NAME + " " + operation + " ";
    }

    private NeaApiException translateFailure(String operation, RestClientException exception) {
        if (exception instanceof RestClientResponseException responseException) {
            return new NeaApiException(HTTP,
                    failurePrefix(operation) + "request failed with HTTP "
                            + responseException.getStatusCode().value(), responseException);
        }
        if (exception instanceof ResourceAccessException) {
            return new NeaApiException(TRANSPORT,
                    failurePrefix(operation) + "request could not be completed", exception);
        }
        return new NeaApiException(INVALID_RESPONSE,
                failurePrefix(operation) + "response could not be decoded", exception);
    }

    private boolean isRetryable(RestClientException exception) {
        if (exception instanceof ResourceAccessException) {
            return true;
        }
        if (exception instanceof RestClientResponseException responseException) {
            int status = responseException.getStatusCode().value();
            return status == 429 || responseException.getStatusCode().is5xxServerError();
        }
        return false;
    }

    /**
     * How long to wait when the failure is a rate limit, or empty when it is not one.
     *
     * Prefers the server's own {@code Retry-After}, which is the only source that knows the
     * real window; falls back to the configured rate-limit backoff when the header is absent
     * or unparseable. data.gov.sg currently states the delay in the error body rather than
     * the header, so the fallback is the path normally taken — but reading the header first
     * means a future change to send one is honoured without another incident like this.
     *
     * Only the delta-seconds form is parsed. The HTTP-date form is legal but unused here, and
     * guessing at a malformed value would be worse than the configured default.
     */
    private Optional<Duration> rateLimitWait(RestClientException exception) {
        if (!(exception instanceof RestClientResponseException responseException)
                || responseException.getStatusCode().value() != 429) {
            return Optional.empty();
        }
        String retryAfter = responseException.getResponseHeaders() == null
                ? null
                : responseException.getResponseHeaders().getFirst(HttpHeaders.RETRY_AFTER);
        if (StringUtils.hasText(retryAfter)) {
            try {
                long seconds = Long.parseLong(retryAfter.trim());
                if (seconds > 0) {
                    return Optional.of(Duration.ofSeconds(seconds));
                }
            } catch (NumberFormatException ignored) {
                // Falls through to the configured default rather than failing the poll.
            }
        }
        return Optional.of(properties.getRateLimitBackoff());
    }

    private void waitBeforeRetry(String operation, Duration backoff) {
        try {
            Thread.sleep(backoff);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new NeaApiException(TRANSPORT,
                    failurePrefix(operation) + "retry was interrupted", exception);
        }
    }

    private Duration nextBackoff(Duration current) {
        Duration doubled = current.multipliedBy(2);
        return doubled.compareTo(properties.getMaxBackoff()) > 0
                ? properties.getMaxBackoff()
                : doubled;
    }

    private void validateEnvelope(String operation, Integer code, String errorMessage) {
        if (code == null) {
            throw invalid(operation + " response is missing its result code");
        }
        if (code != 0) {
            String suffix = StringUtils.hasText(errorMessage) ? ": " + errorMessage : "";
            throw invalid(operation + " response reported code " + code + suffix);
        }
    }

    private <T> List<T> requireNonEmpty(List<T> values, String label) {
        if (values == null || values.isEmpty()) {
            throw invalid(label + " are missing or empty");
        }
        return values;
    }

    private NeaApiException invalid(String message) {
        return new NeaApiException(INVALID_RESPONSE, message);
    }

    private record WbgtResponse(Integer code, WbgtData data, String errorMsg) {
    }

    private record WbgtData(List<WbgtRecord> records) {
    }

    private record WbgtRecord(OffsetDateTime datetime, WbgtItem item) {
    }

    private record WbgtItem(List<WbgtReading> readings) {
    }

    /**
     * {@code wbgt} is read leniently: data.gov.sg sends {@code "NA"} for a station with no
     * reading this interval, and a strict {@link BigDecimal} mapping failed the entire response
     * over one such station. See {@link NeaMissingNumberDeserializer}.
     */
    private record WbgtReading(WbgtStation station, WbgtLocation location,
                               @JsonDeserialize(using = NeaMissingNumberDeserializer.class)
                               BigDecimal wbgt,
                               String heatStress) {
    }

    private record WbgtStation(String id, String name, String townCenter) {
    }

    private record WbgtLocation(BigDecimal latitude, BigDecimal longitude) {
    }

    private record StandardResponse(Integer code, StandardData data, String errorMsg) {
    }

    private record StandardData(List<StandardStation> stations, List<StandardReadingBatch> readings,
                                String readingType, String readingUnit) {
    }

    private record StandardStation(String id, String deviceId, String name,
                                   StandardLocation location) {
    }

    private record StandardLocation(BigDecimal latitude, BigDecimal longitude) {
    }

    private record StandardReadingBatch(OffsetDateTime timestamp, List<StandardReading> data) {
    }

    private record StandardReading(String stationId, BigDecimal value) {
    }
}
