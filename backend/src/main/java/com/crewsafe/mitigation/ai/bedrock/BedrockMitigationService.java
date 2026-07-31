package com.crewsafe.mitigation.ai.bedrock;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.crewsafe.mitigation.domain.MitigationSuggestion;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.services.bedrockruntime.BedrockRuntimeClient;
import software.amazon.awssdk.services.bedrockruntime.model.InvokeModelRequest;
import software.amazon.awssdk.services.bedrockruntime.model.InvokeModelResponse;
import software.amazon.awssdk.core.SdkBytes;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

@Service
@RequiredArgsConstructor
@Slf4j
public class BedrockMitigationService {
    private final BedrockRuntimeClient bedrockClient;
    private final BedrockProperties properties;
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    private static final String STRUCTURED_OUTPUT_SCHEMA = """
        {
          "type": "object",
          "properties": {
            "mitigations": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "priority": {
                    "type": "string",
                    "enum": ["HIGH", "MEDIUM", "LOW"]
                  },
                  "action": {
                    "type": "string",
                    "description": "Brief mitigation action to take"
                  },
                  "rationale": {
                    "type": "string",
                    "description": "Why this mitigation is recommended"
                  },
                  "estimatedImpact": {
                    "type": "string",
                    "description": "Expected heat stress reduction"
                  }
                },
                "required": ["priority", "action", "rationale", "estimatedImpact"]
              }
            }
          },
          "required": ["mitigations"]
        }
        """;

    public MitigationSuggestion.Batch generateMitigations(String context) {
        try {
            log.info("Invoking Bedrock with context: {}", context.substring(0, Math.min(100, context.length())));

            String prompt = buildPrompt(context);
            String requestBody = buildRequestBody(prompt);

            InvokeModelRequest request = InvokeModelRequest.builder()
                    .modelId(properties.getModelId())
                    .contentType("application/json")
                    .accept("application/json")
                    .body(SdkBytes.fromString(requestBody, StandardCharsets.UTF_8))
                    .build();

            long startTime = System.currentTimeMillis();
            InvokeModelResponse response = bedrockClient.invokeModel(request);
            long latency = System.currentTimeMillis() - startTime;

            String responseBody = new String(response.body().asByteArray(), StandardCharsets.UTF_8);
            log.info("Bedrock response received in {}ms", latency);

            return parseResponse(responseBody);
        } catch (Exception e) {
            log.error("Failed to invoke Bedrock for mitigation generation", e);
            throw new BedrockException("Failed to generate mitigations from Bedrock", e);
        }
    }

    private String buildPrompt(String context) {
        return """
            You are a heat stress safety advisor for outdoor work crews in Singapore.
            Given the current weather context and crew status, generate practical mitigation actions
            to reduce heat-stress risk.

            Context:
            %s

            Return a JSON response with an array of mitigation suggestions.
            Each suggestion should have priority (HIGH/MEDIUM/LOW), action, rationale, and estimatedImpact.
            """.formatted(context);
    }

    private String buildRequestBody(String prompt) throws Exception {
        return OBJECT_MAPPER.writeValueAsString(new BedrockRequestBody(
                properties.getModelId(),
                properties.getMaxTokens(),
                properties.getTemperature(),
                prompt,
                STRUCTURED_OUTPUT_SCHEMA
        ));
    }

    private MitigationSuggestion.Batch parseResponse(String responseBody) throws Exception {
        JsonNode root = OBJECT_MAPPER.readTree(responseBody);
        JsonNode content = root.path("content").get(0).path("text");

        if (content == null || content.isNull()) {
            log.warn("No text content in Bedrock response: {}", responseBody);
            return new MitigationSuggestion.Batch(new ArrayList<>());
        }

        String textContent = content.asText();
        JsonNode mitigationsNode = OBJECT_MAPPER.readTree(textContent).path("mitigations");

        if (!mitigationsNode.isArray()) {
            log.warn("Mitigations not an array in response: {}", textContent);
            return new MitigationSuggestion.Batch(new ArrayList<>());
        }

        List<MitigationSuggestion> suggestions = new ArrayList<>();
        mitigationsNode.forEach(node -> {
            try {
                MitigationSuggestion suggestion = new MitigationSuggestion(
                        node.path("priority").asText(),
                        node.path("action").asText(),
                        node.path("rationale").asText(),
                        node.path("estimatedImpact").asText()
                );
                suggestions.add(suggestion);
            } catch (Exception e) {
                log.warn("Failed to parse mitigation suggestion: {}", node, e);
            }
        });

        log.info("Parsed {} mitigation suggestions from Bedrock response", suggestions.size());
        return new MitigationSuggestion.Batch(suggestions);
    }

    private record BedrockRequestBody(
            String modelId,
            int maxTokens,
            double temperature,
            String prompt,
            String outputSchema
    ) {
        @com.fasterxml.jackson.annotation.JsonProperty("model_id")
        public String modelId() { return modelId; }

        @com.fasterxml.jackson.annotation.JsonProperty("max_tokens")
        public int maxTokens() { return maxTokens; }

        public double temperature() { return temperature; }

        @com.fasterxml.jackson.annotation.JsonProperty("messages")
        public List<Message> messages() {
            return List.of(new Message("user", prompt));
        }

        @com.fasterxml.jackson.annotation.JsonProperty("system")
        public String system() { return "You are a heat stress safety expert."; }

        record Message(String role, String content) {}
    }
}
