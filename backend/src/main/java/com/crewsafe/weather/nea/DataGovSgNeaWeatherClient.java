package com.crewsafe.weather.nea;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
 */
@Component
@ConditionalOnProperty(prefix = "app.weather.data", name = "mode", havingValue = "live",
        matchIfMissing = true)
@RequiredArgsConstructor
@Slf4j
public class DataGovSgNeaWeatherClient implements NeaWeatherClient {

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

    private NeaObservation fetchWbgt() {
        WbgtResponse response = execute("WBGT", () -> neaRestClient.get()
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

        List<NeaStationReading> readings = requireNonEmpty(record.item().readings(), "WBGT readings")
                .stream()
                .map(this::mapWbgtReading)
                .toList();
        return new NeaObservation(NeaMetric.WBGT, record.datetime().toInstant(), "deg C", readings);
    }

    private NeaStationReading mapWbgtReading(WbgtReading reading) {
        if (reading == null || reading.station() == null || reading.location() == null
                || !StringUtils.hasText(reading.station().id())
                || !StringUtils.hasText(reading.station().name())
                || reading.location().latitude() == null || reading.location().longitude() == null
                || reading.wbgt() == null) {
            throw invalid("WBGT response contains an incomplete station reading");
        }
        NeaStation station = new NeaStation(
                reading.station().id(),
                reading.station().name(),
                reading.location().latitude(),
                reading.location().longitude());
        return new NeaStationReading(station, reading.wbgt(), reading.heatStress());
    }

    private NeaObservation fetchStandardWeather(NeaMetric metric, String endpointPath) {
        StandardResponse response = execute(metric.name(), () -> neaRestClient.get()
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
        Duration backoff = properties.getInitialBackoff();
        for (int attempt = 1; attempt <= properties.getMaxAttempts(); attempt++) {
            try {
                return request.get();
            } catch (RestClientException exception) {
                NeaApiException failure = translateFailure(operation, exception);
                if (!isRetryable(exception) || attempt == properties.getMaxAttempts()) {
                    throw failure;
                }

                log.warn("data.gov.sg {} attempt {}/{} failed; retrying after {}",
                        operation, attempt, properties.getMaxAttempts(), backoff);
                waitBeforeRetry(operation, backoff);
                backoff = nextBackoff(backoff);
            }
        }
        throw new IllegalStateException("NEA retry loop completed without a result");
    }

    private NeaApiException translateFailure(String operation, RestClientException exception) {
        if (exception instanceof RestClientResponseException responseException) {
            return new NeaApiException(HTTP,
                    "data.gov.sg " + operation + " request failed with HTTP "
                            + responseException.getStatusCode().value(), responseException);
        }
        if (exception instanceof ResourceAccessException) {
            return new NeaApiException(TRANSPORT,
                    "data.gov.sg " + operation + " request could not be completed", exception);
        }
        return new NeaApiException(INVALID_RESPONSE,
                "data.gov.sg " + operation + " response could not be decoded", exception);
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

    private void waitBeforeRetry(String operation, Duration backoff) {
        try {
            Thread.sleep(backoff);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new NeaApiException(TRANSPORT,
                    "data.gov.sg " + operation + " retry was interrupted", exception);
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

    private record WbgtReading(WbgtStation station, WbgtLocation location, BigDecimal wbgt,
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
