package com.crewsafe.mitigation.ai.bedrock;

import com.crewsafe.mitigation.domain.MitigationSuggestion;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;

import java.net.SocketTimeoutException;
import java.time.Duration;
import java.time.Instant;

@Service
@RequiredArgsConstructor
@Slf4j
public class BedrockApiClient {
    private final RestTemplate bedrockRestTemplate;
    private final BedrockProperties properties;
    public MitigationSuggestion.Batch generateMitigations(String context) {
        try {
            Instant start = Instant.now();
            String url = properties.getBedrockApiUrl() + "/bedrock/suggest";

            MitigationRequest request = new MitigationRequest(
                    context,
                    properties.getModelId(),
                    properties.getMaxTokens(),
                    properties.getTemperature()
            );

            log.info("bedrock_request_started");

            MitigationSuggestion.Batch response = bedrockRestTemplate.postForObject(
                    url,
                    request,
                    MitigationSuggestion.Batch.class
            );

            Duration elapsed = Duration.between(start, Instant.now());
            log.info("bedrock_request_completed duration_ms={} suggestion_count={}",
                    elapsed.toMillis(),
                    response != null ? response.mitigations().size() : 0);

            return response;

        } catch (ResourceAccessException e) {
            if (e.getCause() instanceof SocketTimeoutException) {
                log.error("bedrock_request_timeout timeout_ms={}", properties.getBedrockTimeoutMs());
                throw new BedrockTimeoutException(
                        "Bedrock API timeout after " + properties.getBedrockTimeoutMs() + "ms",
                        e
                );
            }
            log.error("bedrock_connection_failed");
            throw new BedrockAccessError("Failed to connect to Bedrock API", e);

        } catch (Exception e) {
            log.error("bedrock_request_failed");
            throw new BedrockException("Bedrock API call failed", e);
        }
    }

    public BedrockAccessStatus checkBedrockAccess() {
        try {
            String url = properties.getBedrockApiUrl() + "/bedrock/access";
            log.info("bedrock_access_check_started");

            BedrockAccessResponse response = bedrockRestTemplate.getForObject(
                    url,
                    BedrockAccessResponse.class
            );

            if (response != null && "ok".equals(response.status())) {
                log.info("bedrock_access_verified");
                return new BedrockAccessStatus(true, response.message(), response.region());
            } else {
                String msg = response != null ? response.message() : "Unknown error";
                String region = response != null ? response.region() : "unknown";
                log.warn("bedrock_access_check_failed");
                return new BedrockAccessStatus(false, msg, region);
            }

        } catch (ResourceAccessException e) {
            if (e.getCause() instanceof SocketTimeoutException) {
                log.error("bedrock_access_timeout");
                throw new BedrockTimeoutException("Bedrock access check timed out", e);
            }
            log.error("bedrock_access_connection_failed");
            throw new BedrockAccessError("Cannot reach Bedrock API", e);

        } catch (Exception e) {
            log.error("bedrock_access_check_failed");
            throw new BedrockException("Bedrock access check failed", e);
        }
    }

    record MitigationRequest(String context, String model_id, int max_tokens, double temperature) {}

    record BedrockAccessResponse(String status, String message, String region) {}

    public record BedrockAccessStatus(boolean accessible, String message, String region) {}
}
