package com.crewsafe.lightning.nea;

import com.crewsafe.weather.nea.NeaApiException;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.Comparator;
import java.util.List;
import java.util.function.Supplier;

import static com.crewsafe.weather.nea.NeaApiException.Reason.HTTP;
import static com.crewsafe.weather.nea.NeaApiException.Reason.INVALID_RESPONSE;
import static com.crewsafe.weather.nea.NeaApiException.Reason.TRANSPORT;

/**
 * Adapter for data.gov.sg's lightning batch, confirmed live at
 * {@code GET /weather?api=lightning} — the same unified {@code /weather} endpoint WBGT uses
 * ({@code DataGovSgNeaWeatherClient}), distinguished by the {@code api} query value. The
 * endpoint is undocumented in data.gov.sg's public developer guide as of this writing; the
 * shape here was taken from the dataset's own downloadable OpenAPI spec
 * ({@code GET https://api-open.data.gov.sg/v2/public/api/datasets/d_08238953fe0f6dd13f10714ebfbcb9f9/initiate-download})
 * and confirmed against a live call. See {@code docs/runbooks/SCRUM-111-weather-ingestion.md}.
 *
 * <p>Unlike WBGT, a reading here is a geolocated strike with no station identity, and
 * {@code readings} may legitimately be empty when NEA detected no strikes.
 *
 * @author Jemilin Beulah
 */
@Component
@ConditionalOnProperty(prefix = "app.weather.data", name = "mode", havingValue = "live",
        matchIfMissing = true)
@RequiredArgsConstructor
public class DataGovSgNeaLightningClient implements NeaLightningClient {

    private static final String LIGHTNING_ENDPOINT_PATH = "/weather";
    private static final String DATASET_QUERY_PARAMETER = "api";
    private static final String LIGHTNING_DATASET_NAME = "lightning";

    private final RestClient neaRestClient;

    @Override
    public NeaLightningObservation fetchLatest() {
        LightningResponse response = execute(() -> neaRestClient.get()
                .uri(uriBuilder -> uriBuilder.path(LIGHTNING_ENDPOINT_PATH)
                        .queryParam(DATASET_QUERY_PARAMETER, LIGHTNING_DATASET_NAME)
                        .build())
                .retrieve()
                .body(LightningResponse.class));
        validateEnvelope(response == null ? null : response.code(),
                response == null ? null : response.errorMsg());

        List<LightningRecord> records = response.data() == null ? null : response.data().records();
        if (records == null || records.isEmpty()) {
            throw invalid("lightning response contains no records");
        }
        if (records.stream().anyMatch(record -> record == null || record.datetime() == null
                || record.item() == null || record.item().readings() == null)) {
            throw invalid("lightning response contains a record missing datetime or readings");
        }
        LightningRecord latest = records.stream()
                .max(Comparator.comparing(LightningRecord::datetime))
                .orElseThrow();

        List<NeaLightningStrike> strikes = latest.item().readings().stream()
                .map(this::mapReading)
                .toList();
        return new NeaLightningObservation(latest.datetime().toInstant(), strikes);
    }

    private NeaLightningStrike mapReading(LightningReading reading) {
        if (reading == null || reading.location() == null
                || reading.location().latitude() == null || reading.location().longitude() == null
                || reading.datetime() == null || !StringUtils.hasText(reading.type())) {
            throw invalid("lightning response contains an incomplete strike reading");
        }
        return new NeaLightningStrike(reading.location().latitude(), reading.location().longitude(),
                reading.datetime().toInstant(), reading.type());
    }

    private <T> T execute(Supplier<T> request) {
        try {
            return request.get();
        } catch (RestClientResponseException exception) {
            throw new NeaApiException(HTTP,
                    "data.gov.sg lightning request failed with HTTP "
                            + exception.getStatusCode().value(), exception);
        } catch (ResourceAccessException exception) {
            throw new NeaApiException(TRANSPORT,
                    "data.gov.sg lightning request could not be completed", exception);
        } catch (NeaApiException exception) {
            throw exception;
        } catch (RestClientException exception) {
            throw new NeaApiException(INVALID_RESPONSE,
                    "data.gov.sg lightning response could not be decoded", exception);
        }
    }

    private void validateEnvelope(Integer code, String errorMessage) {
        if (code == null) {
            throw invalid("lightning response is missing its result code");
        }
        if (code != 0) {
            String suffix = StringUtils.hasText(errorMessage) ? ": " + errorMessage : "";
            throw invalid("lightning response reported code " + code + suffix);
        }
    }

    private NeaApiException invalid(String message) {
        return new NeaApiException(INVALID_RESPONSE, message);
    }

    private record LightningResponse(Integer code, LightningData data, String errorMsg) {
    }

    private record LightningData(List<LightningRecord> records) {
    }

    private record LightningRecord(OffsetDateTime datetime, LightningItem item) {
    }

    private record LightningItem(List<LightningReading> readings) {
    }

    private record LightningReading(LightningLocation location, OffsetDateTime datetime,
                                    String text, String type) {
    }

    private record LightningLocation(BigDecimal latitude, BigDecimal longitude) {
    }
}
