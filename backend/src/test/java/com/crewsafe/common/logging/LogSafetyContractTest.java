package com.crewsafe.common.logging;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

class LogSafetyContractTest {

    private static final List<String> LOGGING_SOURCES = List.of(
            "src/main/java/com/crewsafe/mitigation/ai/bedrock/BedrockApiClient.java",
            "src/main/java/com/crewsafe/mitigation/ai/bedrock/BedrockMitigationService.java",
            "src/main/java/com/crewsafe/identity/security/CognitoJwtAuthenticationConverter.java",
            "src/main/java/com/crewsafe/common/error/GlobalExceptionHandler.java",
            "src/main/java/com/crewsafe/identity/security/SiteAccessEvaluator.java",
            "src/main/java/com/crewsafe/operation/api/ActionDispatchController.java",
            "src/main/java/com/crewsafe/operation/service/ActionDispatchService.java",
            "src/main/java/com/crewsafe/policy/service/PolicyEngineService.java",
            "src/main/java/com/crewsafe/conditions/service/SiteConditionsStreamService.java",
            "src/main/java/com/crewsafe/mitigation/api/TestBedrockController.java",
            "src/main/java/com/crewsafe/weather/ingestion/WeatherIngestionScheduler.java",
            "src/main/java/com/crewsafe/lightning/ingestion/LightningIngestionScheduler.java",
            "src/main/java/com/crewsafe/weather/fixture/FixtureNeaWeatherClient.java",
            "src/main/java/com/crewsafe/lightning/fixture/FixtureNeaLightningClient.java",
            "src/main/java/com/crewsafe/identity/DemoDataSeeder.java"
    );

    private static final List<String> UNSAFE_LOG_TOKENS = List.of(
            "context",
            "responseBody",
            "textContent",
            "jwt.getSubject()",
            "principal.getId()",
            "request.getWorkerId()",
            "dispatchId",
            "workerId",
            "siteId",
            "e.getMessage()",
            "exception)",
            "exception,",
            "log.error(\"Unhandled exception\", e)"
    );

    @Test
    void dynamicLogArgumentsDoNotContainCredentialsTokensPiiOrRawExceptionText() throws IOException {
        try (Stream<Path> paths = LOGGING_SOURCES.stream().map(Path::of)) {
            paths.forEach(path -> {
                String source = read(path);
                source.lines()
                        .filter(line -> line.contains("log."))
                        .forEach(line -> UNSAFE_LOG_TOKENS.forEach(token ->
                                assertThat(line)
                                        .as("unsafe dynamic logging token %s in %s", token, path)
                                        .doesNotContain(token)));
            });
        }
    }

    private String read(Path path) {
        try {
            return Files.readString(path);
        }
        catch (IOException exception) {
            throw new AssertionError("Unable to read source guard target " + path, exception);
        }
    }
}
