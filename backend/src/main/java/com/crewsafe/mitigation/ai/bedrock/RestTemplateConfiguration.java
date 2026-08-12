package com.crewsafe.mitigation.ai.bedrock;

import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.BufferingClientHttpRequestFactory;
import org.springframework.http.client.ClientHttpRequestFactory;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestTemplate;

import java.time.Duration;

@Configuration
public class RestTemplateConfiguration {

    @Bean(name = "bedrockRestTemplate")
    public RestTemplate bedrockRestTemplate(BedrockProperties properties) {
        // Configure timeouts on the factory itself
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        int timeoutMs = (int) Duration.ofMillis(properties.getBedrockTimeoutMs()).toMillis();
        factory.setConnectTimeout(timeoutMs);
        factory.setReadTimeout(timeoutMs);

        // Wrap with buffering factory for error handling and response logging
        return new RestTemplateBuilder()
                .requestFactory(() -> new BufferingClientHttpRequestFactory(factory))
                .build();
    }
}
