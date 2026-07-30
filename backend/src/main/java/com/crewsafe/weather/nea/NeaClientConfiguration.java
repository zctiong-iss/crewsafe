package com.crewsafe.weather.nea;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;

import java.net.http.HttpClient;

/**
 * Builds the dedicated HTTP client used only for NEA/data.gov.sg calls.
 *
 * @author Bryan Phang
 */
@Configuration
public class NeaClientConfiguration {

    @Bean
    RestClient neaRestClient(RestClient.Builder builder, NeaApiProperties properties) {
        HttpClient httpClient = HttpClient.newBuilder()
                .connectTimeout(properties.getConnectTimeout())
                .build();
        JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(httpClient);
        requestFactory.setReadTimeout(properties.getReadTimeout());

        RestClient.Builder neaBuilder = builder
                .baseUrl(properties.getBaseUrl())
                .requestFactory(requestFactory)
                .defaultHeader(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE);

        if (StringUtils.hasText(properties.getApiKey())) {
            neaBuilder.defaultHeader("x-api-key", properties.getApiKey());
        }

        return neaBuilder.build();
    }
}
