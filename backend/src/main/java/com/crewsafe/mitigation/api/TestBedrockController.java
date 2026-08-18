package com.crewsafe.mitigation.api;

import com.crewsafe.mitigation.ai.bedrock.BedrockApiClient;
import com.crewsafe.mitigation.ai.bedrock.BedrockException;
import com.crewsafe.mitigation.ai.bedrock.BedrockTimeoutException;
import com.crewsafe.mitigation.domain.MitigationSuggestion;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/test/bedrock")
@RequiredArgsConstructor
@Slf4j
public class TestBedrockController {
    private final BedrockApiClient bedrockApiClient;

    @GetMapping("/access")
    public ResponseEntity<Object> checkBedrockAccess() {
        try {
            var status = bedrockApiClient.checkBedrockAccess();
            return ResponseEntity.ok(status);
        } catch (BedrockTimeoutException e) {
            log.error("bedrock_access_timeout");
            return ResponseEntity.status(HttpStatus.GATEWAY_TIMEOUT)
                    .body(new ErrorResponse("Bedrock API timeout", "access_timeout"));
        } catch (BedrockException e) {
            log.error("bedrock_access_failure");
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(new ErrorResponse("Bedrock service unavailable", "bedrock_error"));
        }
    }

    @PostMapping("/mitigations")
    public ResponseEntity<Object> generateMitigations(@RequestBody MitigationContextRequest request) {
        try {
            MitigationSuggestion.Batch batch = bedrockApiClient.generateMitigations(request.context());
            return ResponseEntity.ok(batch);
        } catch (BedrockTimeoutException e) {
            log.error("bedrock_mitigation_timeout");
            return ResponseEntity.status(HttpStatus.GATEWAY_TIMEOUT)
                    .body(new ErrorResponse(
                            "Bedrock API timeout - request took too long",
                            "bedrock_timeout"
                    ));
        } catch (BedrockException e) {
            log.error("bedrock_mitigation_failure");
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(new ErrorResponse("Bedrock service unavailable", "bedrock_error"));
        } catch (Exception e) {
            log.error("bedrock_mitigation_unexpected_failure");
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(new ErrorResponse("Internal server error", "internal_error"));
        }
    }

    record MitigationContextRequest(String context) {}

    record ErrorResponse(String message, String errorCode) {}
}
