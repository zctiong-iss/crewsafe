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
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout((int) Duration.ofMillis(properties.getBedrockTimeoutMs()).toMillis());
        factory.setReadTimeout((int) Duration.ofMillis(properties.getBedrockTimeoutMs()).toMillis());

        return new RestTemplateBuilder()
                .requestFactory(() -> new BufferingClientHttpRequestFactory(factory))
                .setConnectTimeout(Duration.ofMillis(properties.getBedrockTimeoutMs()))
                .setReadTimeout(Duration.ofMillis(properties.getBedrockTimeoutMs()))
                .build();
    }
}
