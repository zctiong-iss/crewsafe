package com.crewsafe.mitigation.ai.bedrock;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for BedrockProperties configuration.
 *
 * Tests verify that Bedrock API configuration properties are correctly bound,
 * validated, and provide sensible defaults.
 */
@DisplayName("BedrockProperties")
class BedrockPropertiesTest {

    private BedrockProperties properties;

    @BeforeEach
    void setUp() {
        properties = new BedrockProperties();
    }

    @Test
    @DisplayName("Default values are set correctly")
    void defaultValuesAreSet() {
        assertThat(properties.getRegion())
                .isEqualTo("ap-southeast-1");
        assertThat(properties.getModelId())
                .isEqualTo("global.anthropic.claude-haiku-4-5-20251001-v1:0");
        assertThat(properties.getMaxTokens())
                .isEqualTo(4096);
        assertThat(properties.getTemperature())
                .isEqualTo(0.7);
        assertThat(properties.getBedrockApiUrl())
                .isEqualTo("http://localhost:8000");
        assertThat(properties.getBedrockTimeoutMs())
                .isEqualTo(30000);
    }

    @Test
    @DisplayName("Default model ID carries an inference-profile prefix")
    void defaultModelIdIsAnInferenceProfile() {
        // Regression guard for the SCRUM-286 live-call bug: this AWS account has no
        // on-demand throughput for Claude, so a bare "anthropic.*" model ID 400s.
        // Only a cross-region inference profile ("global."/"apac."/"us."/"eu.") works.
        assertThat(properties.getModelId())
                .matches("^(global|apac|us|eu)\\.anthropic\\..+");
    }

    @Test
    @DisplayName("Default timeout exceeds the measured p95 draft latency")
    void defaultTimeoutExceedsMeasuredLatency() {
        // SCRUM-287 measured a p95 of 10.4s for the selected model. The previous
        // 5000ms default made every LLM draft time out into the fallback path.
        assertThat(properties.getBedrockTimeoutMs())
                .isGreaterThan(10_400);
    }

    @Test
    @DisplayName("Region can be set and retrieved")
    void regionCanBeSetAndRetrieved() {
        String newRegion = "us-west-2";
        properties.setRegion(newRegion);

        assertThat(properties.getRegion())
                .isEqualTo(newRegion);
    }

    @Test
    @DisplayName("Model ID can be set and retrieved")
    void modelIdCanBeSetAndRetrieved() {
        String newModelId = "anthropic.claude-3-opus-20240229-v1:0";
        properties.setModelId(newModelId);

        assertThat(properties.getModelId())
                .isEqualTo(newModelId);
    }

    @Test
    @DisplayName("Max tokens can be set and retrieved")
    void maxTokensCanBeSetAndRetrieved() {
        int newMaxTokens = 2048;
        properties.setMaxTokens(newMaxTokens);

        assertThat(properties.getMaxTokens())
                .isEqualTo(newMaxTokens);
    }

    @Test
    @DisplayName("Temperature can be set and retrieved")
    void temperatureCanBeSetAndRetrieved() {
        double newTemperature = 0.5;
        properties.setTemperature(newTemperature);

        assertThat(properties.getTemperature())
                .isEqualTo(newTemperature);
    }

    @Test
    @DisplayName("Bedrock API URL can be set and retrieved")
    void bedrockApiUrlCanBeSetAndRetrieved() {
        String newUrl = "https://bedrock.api.example.com";
        properties.setBedrockApiUrl(newUrl);

        assertThat(properties.getBedrockApiUrl())
                .isEqualTo(newUrl);
    }

    @Test
    @DisplayName("Bedrock timeout can be set and retrieved")
    void bedrockTimeoutCanBeSetAndRetrieved() {
        int newTimeout = 10000;
        properties.setBedrockTimeoutMs(newTimeout);

        assertThat(properties.getBedrockTimeoutMs())
                .isEqualTo(newTimeout);
    }

    @Test
    @DisplayName("All setters work together")
    void allSetterWorkTogether() {
        properties.setRegion("eu-central-1");
        properties.setModelId("custom-model:1.0");
        properties.setMaxTokens(4096);
        properties.setTemperature(0.9);
        properties.setBedrockApiUrl("https://custom.bedrock.api");
        properties.setBedrockTimeoutMs(15000);

        assertThat(properties.getRegion()).isEqualTo("eu-central-1");
        assertThat(properties.getModelId()).isEqualTo("custom-model:1.0");
        assertThat(properties.getMaxTokens()).isEqualTo(4096);
        assertThat(properties.getTemperature()).isEqualTo(0.9);
        assertThat(properties.getBedrockApiUrl()).isEqualTo("https://custom.bedrock.api");
        assertThat(properties.getBedrockTimeoutMs()).isEqualTo(15000);
    }

    @Test
    @DisplayName("Properties support configuration binding")
    void propertiesSupportConfigurationBinding() {
        // Verify all properties have proper getters and setters for Spring binding
        assertThat(properties)
                .hasNoNullFieldsOrPropertiesExcept();

        // Verify defaults are reasonable
        assertThat(properties.getBedrockTimeoutMs())
                .isPositive()
                .isLessThan(60000);  // Less than 60 seconds

        assertThat(properties.getMaxTokens())
                .isPositive();

        assertThat(properties.getTemperature())
                .isBetween(0.0, 2.0);
    }
}
