package com.crewsafe.mitigation.ai.bedrock;

import com.crewsafe.mitigation.domain.MitigationSuggestion;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
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
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

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

            log.info("Calling Bedrock API at {} with context: {}", url,
                    context.substring(0, Math.min(50, context.length())));

            MitigationSuggestion.Batch response = bedrockRestTemplate.postForObject(
                    url,
                    request,
                    MitigationSuggestion.Batch.class
            );

            Duration elapsed = Duration.between(start, Instant.now());
            log.info("Bedrock API call completed in {}ms, received {} suggestions",
                    elapsed.toMillis(),
                    response != null ? response.mitigations().size() : 0);

            return response;

        } catch (ResourceAccessException e) {
            if (e.getCause() instanceof SocketTimeoutException) {
                log.error("Bedrock API timeout after {}ms", properties.getBedrockTimeoutMs());
                throw new BedrockTimeoutException(
                        "Bedrock API timeout after " + properties.getBedrockTimeoutMs() + "ms",
                        e
                );
            }
            log.error("Bedrock API connection error", e);
            throw new BedrockAccessError("Failed to connect to Bedrock API: " + e.getMessage(), e);

        } catch (Exception e) {
            log.error("Bedrock API call failed", e);
            throw new BedrockException("Bedrock API call failed: " + e.getMessage(), e);
        }
    }

    public BedrockAccessStatus checkBedrockAccess() {
        try {
            String url = properties.getBedrockApiUrl() + "/bedrock/access";
            log.info("Checking Bedrock access at {}", url);

            BedrockAccessResponse response = bedrockRestTemplate.getForObject(
                    url,
                    BedrockAccessResponse.class
            );

            if (response != null && "ok".equals(response.status())) {
                log.info("Bedrock access verified: {}", response.message());
                return new BedrockAccessStatus(true, response.message(), response.region());
            } else {
                String msg = response != null ? response.message() : "Unknown error";
                String region = response != null ? response.region() : "unknown";
                log.warn("Bedrock access check failed: {}", msg);
                return new BedrockAccessStatus(false, msg, region);
            }

        } catch (ResourceAccessException e) {
            if (e.getCause() instanceof SocketTimeoutException) {
                log.error("Bedrock access check timeout");
                throw new BedrockTimeoutException("Bedrock access check timed out", e);
            }
            log.error("Cannot reach Bedrock API", e);
            throw new BedrockAccessError("Cannot reach Bedrock API: " + e.getMessage(), e);

        } catch (Exception e) {
            log.error("Bedrock access check failed", e);
            throw new BedrockException("Bedrock access check failed: " + e.getMessage(), e);
        }
    }

    record MitigationRequest(String context, String model_id, int max_tokens, double temperature) {}

    record BedrockAccessResponse(String status, String message, String region) {}

    public record BedrockAccessStatus(boolean accessible, String message, String region) {}
}
