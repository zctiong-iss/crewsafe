package com.crewsafe.mitigation.ai.bedrock;

import com.crewsafe.mitigation.domain.MitigationSuggestion;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;

import java.net.SocketTimeoutException;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class BedrockApiClientTest {

    private RestTemplate restTemplate;
    private BedrockProperties properties;
    private BedrockApiClient client;

    @BeforeEach
    void setUp() {
        restTemplate = mock(RestTemplate.class);
        properties = new BedrockProperties();
        properties.setBedrockApiUrl("http://localhost:8000");
        properties.setBedrockTimeoutMs(5000);

        client = new BedrockApiClient(restTemplate, properties);
    }

    @Test
    void shouldGenerateMitigationsViaRestAPI() {
        // Arrange
        MitigationSuggestion suggestion = new MitigationSuggestion(
                "HIGH",
                "Reduce work hours",
                "WBGT critical",
                "15% reduction"
        );
        MitigationSuggestion.Batch expectedBatch = new MitigationSuggestion.Batch(List.of(suggestion));

        when(restTemplate.postForObject(
                eq("http://localhost:8000/bedrock/suggest"),
                org.mockito.ArgumentMatchers.any(),
                eq(MitigationSuggestion.Batch.class)
        )).thenReturn(expectedBatch);

        // Act
        MitigationSuggestion.Batch result = client.generateMitigations("Current WBGT: 35°C");

        // Assert
        assertThat(result.mitigations()).hasSize(1);
        assertThat(result.mitigations().get(0).priority()).isEqualTo("HIGH");
    }

    @Test
    void shouldThrowBedrockTimeoutExceptionOnSocketTimeout() {
        // Arrange
        SocketTimeoutException timeoutException = new SocketTimeoutException("Connection timeout");
        ResourceAccessException resourceException = new ResourceAccessException("Timeout", timeoutException);

        when(restTemplate.postForObject(
                eq("http://localhost:8000/bedrock/suggest"),
                org.mockito.ArgumentMatchers.any(),
                eq(MitigationSuggestion.Batch.class)
        )).thenThrow(resourceException);

        // Act & Assert
        assertThatThrownBy(() -> client.generateMitigations("test context"))
                .isInstanceOf(BedrockTimeoutException.class)
                .hasMessageContaining("timeout after 5000ms")
                .hasCauseInstanceOf(ResourceAccessException.class);
    }

    @Test
    void shouldThrowBedrockAccessErrorOnConnectionFailure() {
        // Arrange
        ResourceAccessException connectionException = new ResourceAccessException(
                "Connection refused",
                new java.net.ConnectException("Connection refused")
        );

        when(restTemplate.postForObject(
                eq("http://localhost:8000/bedrock/suggest"),
                org.mockito.ArgumentMatchers.any(),
                eq(MitigationSuggestion.Batch.class)
        )).thenThrow(connectionException);

        // Act & Assert
        assertThatThrownBy(() -> client.generateMitigations("test context"))
                .isInstanceOf(BedrockAccessError.class)
                .hasMessageContaining("Failed to connect to Bedrock API")
                .hasCauseInstanceOf(ResourceAccessException.class);
    }

    @Test
    void shouldCheckBedrockAccess() {
        // Arrange
        BedrockApiClient.BedrockAccessResponse response = new BedrockApiClient.BedrockAccessResponse(
                "ok",
                "✓ Bedrock model access confirmed in region=ap-southeast-1",
                "ap-southeast-1"
        );

        when(restTemplate.getForObject(
                eq("http://localhost:8000/bedrock/access"),
                eq(BedrockApiClient.BedrockAccessResponse.class)
        )).thenReturn(response);

        // Act
        BedrockApiClient.BedrockAccessStatus status = client.checkBedrockAccess();

        // Assert
        assertThat(status.accessible()).isTrue();
        assertThat(status.region()).isEqualTo("ap-southeast-1");
        assertThat(status.message()).contains("confirmed");
    }

    @Test
    void shouldThrowTimeoutOnAccessCheck() {
        // Arrange
        SocketTimeoutException timeoutException = new SocketTimeoutException("Timeout");
        ResourceAccessException resourceException = new ResourceAccessException("Timeout", timeoutException);

        when(restTemplate.getForObject(
                eq("http://localhost:8000/bedrock/access"),
                eq(BedrockApiClient.BedrockAccessResponse.class)
        )).thenThrow(resourceException);

        // Act & Assert
        assertThatThrownBy(() -> client.checkBedrockAccess())
                .isInstanceOf(BedrockTimeoutException.class)
                .hasMessageContaining("timed out");
    }

    @Test
    void shouldThrowAccessErrorWhenAPIUnavailable() {
        // Arrange
        ResourceAccessException connectionException = new ResourceAccessException("Cannot reach API");

        when(restTemplate.getForObject(
                eq("http://localhost:8000/bedrock/access"),
                eq(BedrockApiClient.BedrockAccessResponse.class)
        )).thenThrow(connectionException);

        // Act & Assert
        assertThatThrownBy(() -> client.checkBedrockAccess())
                .isInstanceOf(BedrockAccessError.class)
                .hasMessageContaining("Cannot reach Bedrock API");
    }
}
