package com.crewsafe.mitigation.ai.bedrock;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.bedrockruntime.BedrockRuntimeClient;

@Configuration
@EnableConfigurationProperties(BedrockProperties.class)
public class BedrockClientConfiguration {

    @Bean
    public BedrockRuntimeClient bedrockRuntimeClient(BedrockProperties properties) {
        return BedrockRuntimeClient.builder()
                .region(Region.of(properties.getRegion()))
                .build();
    }
}
