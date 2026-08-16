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

    /**
     * Model selected in SCRUM-287 against the §8.6 evaluation set. The
     * cross-region inference-profile prefix is mandatory: this AWS account has no
     * on-demand throughput, so the bare {@code anthropic.*} form returns a 400.
     */
    private String modelId = "global.anthropic.claude-haiku-4-5-20251001-v1:0";

    /** 1024 truncated every multi-worker plan mid-JSON during the SCRUM-287 benchmark. */
    private int maxTokens = 4096;

    private double temperature = 0.7;
    private String bedrockApiUrl = "http://localhost:8000";

    /** Measured p95 for the selected model is 10.4s, before any throttling retry. */
    private int bedrockTimeoutMs = 30000;

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
