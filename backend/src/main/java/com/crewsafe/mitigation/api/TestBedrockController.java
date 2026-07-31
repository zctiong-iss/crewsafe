package com.crewsafe.mitigation.api;

import com.crewsafe.mitigation.ai.bedrock.BedrockMitigationService;
import com.crewsafe.mitigation.domain.MitigationSuggestion;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/test/bedrock")
@RequiredArgsConstructor
public class TestBedrockController {
    private final BedrockMitigationService mitigationService;

    @PostMapping("/mitigations")
    public MitigationSuggestion.Batch generateMitigations(@RequestBody MitigationContextRequest request) {
        return mitigationService.generateMitigations(request.context());
    }

    record MitigationContextRequest(String context) {}
}
