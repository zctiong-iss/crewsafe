package com.crewsafe.common.logging;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.spi.LoggingEvent;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.boot.logging.logback.StructuredLogEncoder;
import org.springframework.core.env.Environment;
import org.springframework.mock.env.MockEnvironment;

import java.nio.charset.StandardCharsets;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class StructuredLoggingContractTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void applicationConfigSelectsEcsConsoleLoggingAndStableServiceMetadata() throws Exception {
        String config = new String(
                getClass().getResourceAsStream("/application.yml").readAllBytes(), StandardCharsets.UTF_8);

        assertThat(config).contains("format:\n      console: ecs");
        assertThat(config).contains("name: ${spring.application.name}");
        assertThat(config).contains("environment: ${SPRING_PROFILES_ACTIVE:local}");
        assertThat(config).doesNotContain("pattern:");
    }

    @Test
    void ecsEncoderProducesOneParseableRecordWithRequestCorrelation() throws Exception {
        String requestId = "123e4567-e89b-12d3-a456-426614174000";
        LoggerContext context = new LoggerContext();
        MockEnvironment environment = new MockEnvironment()
                .withProperty("spring.application.name", "crewsafe-backend")
                .withProperty("logging.structured.ecs.service.environment", "staging");
        context.putObject(Environment.class.getName(), environment);

        StructuredLogEncoder encoder = new StructuredLogEncoder();
        encoder.setContext(context);
        encoder.setFormat("ecs");
        encoder.start();
        try {
            LoggingEvent event = new LoggingEvent();
            event.setLoggerName("com.crewsafe.common.logging.StructuredLoggingContractTest");
            event.setLevel(Level.INFO);
            event.setMessage("structured log contract");
            event.setThreadName("test-thread");
            event.setMDCPropertyMap(Map.of("requestId", requestId));
            event.setTimeStamp(System.currentTimeMillis());

            String encoded = new String(encoder.encode(event), StandardCharsets.UTF_8);
            assertThat(encoded.trim()).doesNotContain("\r", "\n");
            JsonNode logRecord = objectMapper.readTree(encoded);

            assertThat(logRecord.get("message").asText()).isEqualTo("structured log contract");
            assertThat(logRecord.at("/log/level").asText()).isEqualTo("INFO");
            assertThat(logRecord.at("/requestId").asText()).isEqualTo(requestId);
            assertThat(logRecord.at("/service/name").asText()).isEqualTo("crewsafe-backend");
            assertThat(logRecord.at("/service/environment").asText()).isEqualTo("staging");
            assertThat(logRecord.at("/ecs/version").asText()).isEqualTo("8.11");
        }
        finally {
            encoder.stop();
            context.stop();
        }
    }
}
