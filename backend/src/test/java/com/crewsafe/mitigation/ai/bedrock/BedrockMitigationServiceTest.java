package com.crewsafe.mitigation.ai.bedrock;

import com.crewsafe.mitigation.domain.MitigationSuggestion;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import software.amazon.awssdk.core.SdkBytes;
import software.amazon.awssdk.services.bedrockruntime.BedrockRuntimeClient;
import software.amazon.awssdk.services.bedrockruntime.model.InvokeModelRequest;
import software.amazon.awssdk.services.bedrockruntime.model.InvokeModelResponse;

import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class BedrockMitigationServiceTest {

    @Mock
    private BedrockRuntimeClient bedrockClient;

    @Mock
    private BedrockProperties properties;

    private BedrockMitigationService service;

    @BeforeEach
    void setUp() {
        service = new BedrockMitigationService(bedrockClient, properties);
        when(properties.getModelId()).thenReturn("anthropic.claude-3-5-sonnet-20241022-v2:0");
        when(properties.getMaxTokens()).thenReturn(1024);
        when(properties.getTemperature()).thenReturn(0.7);
    }

    @Test
    void shouldParseMitigationSuggestionsFromBedrockResponse() {
        String mockResponse = """
            {
              "content": [
                {
                  "type": "text",
                  "text": "{\\"mitigations\\": [{\\"priority\\": \\"HIGH\\", \\"action\\": \\"Reduce work hours\\", \\"rationale\\": \\"WBGT exceeds safety threshold\\", \\"estimatedImpact\\": \\"10-15% reduction in heat stress\\"}]}"
                }
              ]
            }
            """;

        InvokeModelResponse mockInvokeResponse = InvokeModelResponse.builder()
                .body(SdkBytes.fromString(mockResponse, StandardCharsets.UTF_8))
                .build();

        when(bedrockClient.invokeModel((InvokeModelRequest) any())).thenReturn(mockInvokeResponse);

        MitigationSuggestion.Batch result = service.generateMitigations("Current WBGT: 35°C");

        assertThat(result.mitigations()).hasSize(1);
        assertThat(result.mitigations().get(0).priority()).isEqualTo("HIGH");
        assertThat(result.mitigations().get(0).code()).isEqualTo("Reduce work hours");
    }

    @Test
    void shouldHandleMultipleMitigationSuggestions() {
        String mockResponse = """
            {
              "content": [
                {
                  "type": "text",
                  "text": "{\\"mitigations\\": [{\\"priority\\": \\"HIGH\\", \\"action\\": \\"Reduce work hours\\", \\"rationale\\": \\"WBGT critical\\", \\"estimatedImpact\\": \\"15%\\"}, {\\"priority\\": \\"MEDIUM\\", \\"action\\": \\"Increase water breaks\\", \\"rationale\\": \\"Hydration\\", \\"estimatedImpact\\": \\"5%\\"}]}"
                }
              ]
            }
            """;

        InvokeModelResponse mockInvokeResponse = InvokeModelResponse.builder()
                .body(SdkBytes.fromString(mockResponse, StandardCharsets.UTF_8))
                .build();

        when(bedrockClient.invokeModel((InvokeModelRequest) any())).thenReturn(mockInvokeResponse);

        MitigationSuggestion.Batch result = service.generateMitigations("Current WBGT: 35°C");

        assertThat(result.mitigations()).hasSize(2);
        assertThat(result.mitigations()).extracting(MitigationSuggestion::priority)
                .containsExactly("HIGH", "MEDIUM");
    }

    @Test
    void shouldThrowBedrockExceptionOnClientError() {
        when(bedrockClient.invokeModel((InvokeModelRequest) any())).thenThrow(new RuntimeException("Connection failed"));

        assertThatThrownBy(() -> service.generateMitigations("test context"))
                .isInstanceOf(BedrockException.class)
                .hasMessage("Failed to generate mitigations from Bedrock")
                .hasCauseInstanceOf(RuntimeException.class);
    }

    @Test
    void shouldReturnEmptyBatchForEmptyResponse() {
        String mockResponse = """
            {
              "content": [
                {
                  "type": "text",
                  "text": "{\\"mitigations\\": []}"
                }
              ]
            }
            """;

        InvokeModelResponse mockInvokeResponse = InvokeModelResponse.builder()
                .body(SdkBytes.fromString(mockResponse, StandardCharsets.UTF_8))
                .build();

        when(bedrockClient.invokeModel((InvokeModelRequest) any())).thenReturn(mockInvokeResponse);

        MitigationSuggestion.Batch result = service.generateMitigations("test context");

        assertThat(result.mitigations()).isEmpty();
    }
}
