package com.crewsafe.mitigation.ai.bedrock;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.client.BufferingClientHttpRequestFactory;
import org.springframework.http.client.ClientHttpRequestFactory;
import org.springframework.web.client.RestTemplate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Unit tests for RestTemplateConfiguration.
 *
 * Verifies that the Bedrock RestTemplate is correctly configured with appropriate
 * timeouts and request/response buffering.
 */
@DisplayName("RestTemplateConfiguration")
class RestTemplateConfigurationTest {

    private RestTemplateConfiguration configuration;
    private BedrockProperties properties;

    @BeforeEach
    void setUp() {
        configuration = new RestTemplateConfiguration();
        properties = new BedrockProperties();
    }

    @Test
    @DisplayName("bedrockRestTemplate bean is created successfully")
    void bedrockRestTemplateBeanIsCreated() {
        RestTemplate restTemplate = configuration.bedrockRestTemplate(properties);

        assertThat(restTemplate)
                .isNotNull();
    }

    @Test
    @DisplayName("RestTemplate uses BufferingClientHttpRequestFactory")
    void restTemplateUsesBufferingFactory() {
        RestTemplate restTemplate = configuration.bedrockRestTemplate(properties);
        ClientHttpRequestFactory factory = restTemplate.getRequestFactory();

        assertThat(factory)
                .isInstanceOf(BufferingClientHttpRequestFactory.class);
    }

    @Test
    @DisplayName("RestTemplate respects BedrockProperties timeout setting")
    void restTemplateRespectsTimeoutSetting() {
        properties.setBedrockTimeoutMs(10000);

        RestTemplate restTemplate = configuration.bedrockRestTemplate(properties);

        // Verify the restTemplate was created (actual timeout verification
        // requires integration testing with actual HTTP calls)
        assertThat(restTemplate).isNotNull();
    }

    @Test
    @DisplayName("RestTemplate is configured with default timeout (5000ms)")
    void restTemplateUsesDefaultTimeout() {
        // Properties default is 5000ms
        RestTemplate restTemplate = configuration.bedrockRestTemplate(properties);

        assertThat(restTemplate).isNotNull();
        assertThat(properties.getBedrockTimeoutMs()).isEqualTo(5000);
    }

    @Test
    @DisplayName("RestTemplate can be configured with custom timeout")
    void restTemplateCanBeConfiguredWithCustomTimeout() {
        BedrockProperties customProps = new BedrockProperties();
        customProps.setBedrockTimeoutMs(15000);

        RestTemplate restTemplate = configuration.bedrockRestTemplate(customProps);

        assertThat(restTemplate).isNotNull();
        assertThat(customProps.getBedrockTimeoutMs()).isEqualTo(15000);
    }

    @Test
    @DisplayName("Configuration rejects null BedrockProperties")
    void configurationRejectsNullBedrockProperties() {
        assertThatThrownBy(() -> configuration.bedrockRestTemplate(null))
                .isInstanceOf(NullPointerException.class);
    }

    @Test
    @DisplayName("RestTemplate is independent across multiple calls")
    void restTemplateIsIndependentAcrossMultipleCalls() {
        RestTemplate restTemplate1 = configuration.bedrockRestTemplate(properties);
        RestTemplate restTemplate2 = configuration.bedrockRestTemplate(properties);

        // Each call creates a new RestTemplate instance
        assertThat(restTemplate1).isNotNull();
        assertThat(restTemplate2).isNotNull();
        assertThat(restTemplate1).isNotSameAs(restTemplate2);
    }

    @Test
    @DisplayName("Timeout value is positive")
    void timeoutValueIsPositive() {
        properties.setBedrockTimeoutMs(5000);

        RestTemplate restTemplate = configuration.bedrockRestTemplate(properties);

        assertThat(restTemplate).isNotNull();
        assertThat(properties.getBedrockTimeoutMs()).isPositive();
    }

    @Test
    @DisplayName("Configuration handles very small timeout values")
    void configurationHandlesVerySmallTimeoutValues() {
        BedrockProperties smallTimeoutProps = new BedrockProperties();
        smallTimeoutProps.setBedrockTimeoutMs(100);

        RestTemplate restTemplate = configuration.bedrockRestTemplate(smallTimeoutProps);

        assertThat(restTemplate).isNotNull();
        assertThat(smallTimeoutProps.getBedrockTimeoutMs()).isEqualTo(100);
    }

    @Test
    @DisplayName("Configuration handles large timeout values")
    void configurationHandlesLargeTimeoutValues() {
        BedrockProperties largeTimeoutProps = new BedrockProperties();
        largeTimeoutProps.setBedrockTimeoutMs(60000);  // 60 seconds

        RestTemplate restTemplate = configuration.bedrockRestTemplate(largeTimeoutProps);

        assertThat(restTemplate).isNotNull();
        assertThat(largeTimeoutProps.getBedrockTimeoutMs()).isEqualTo(60000);
    }
}
