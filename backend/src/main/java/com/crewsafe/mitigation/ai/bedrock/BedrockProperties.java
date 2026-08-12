package com.crewsafe.mitigation.ai.bedrock;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Properties for Amazon Bedrock AI API configuration.
 * Binds to 'app.bedrock.*' properties from application.yml.
 *
 * Note: Registered via @ConfigurationPropertiesScan in the application.
 * Do not add @Component - it causes double-registration and context startup failures.
 */
@ConfigurationProperties(prefix = "app.bedrock")
public class BedrockProperties {
    private String region = "ap-southeast-1";
    private String modelId = "anthropic.claude-3-5-sonnet-20241022-v2:0";
    private int maxTokens = 1024;
    private double temperature = 0.7;
    private String bedrockApiUrl = "http://localhost:8000";
    private int bedrockTimeoutMs = 5000;

    public String getRegion() {
        return region;
    }

    public void setRegion(String region) {
        this.region = region;
    }

    public String getModelId() {
        return modelId;
    }

    public void setModelId(String modelId) {
        this.modelId = modelId;
    }

    public int getMaxTokens() {
        return maxTokens;
    }

    public void setMaxTokens(int maxTokens) {
        this.maxTokens = maxTokens;
    }

    public double getTemperature() {
        return temperature;
    }

    public void setTemperature(double temperature) {
        this.temperature = temperature;
    }

    public String getBedrockApiUrl() {
        return bedrockApiUrl;
    }

    public void setBedrockApiUrl(String bedrockApiUrl) {
        this.bedrockApiUrl = bedrockApiUrl;
    }

    public int getBedrockTimeoutMs() {
        return bedrockTimeoutMs;
    }

    public void setBedrockTimeoutMs(int bedrockTimeoutMs) {
        this.bedrockTimeoutMs = bedrockTimeoutMs;
    }
}
