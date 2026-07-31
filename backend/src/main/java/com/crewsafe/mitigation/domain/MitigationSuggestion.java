package com.crewsafe.mitigation.domain;

import java.util.List;

public record MitigationSuggestion(
    String priority,
    String action,
    String rationale,
    String estimatedImpact
) {
    public record Batch(List<MitigationSuggestion> mitigations) {}
}
