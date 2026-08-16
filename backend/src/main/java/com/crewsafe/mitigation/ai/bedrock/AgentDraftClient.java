package com.crewsafe.mitigation.ai.bedrock;

import com.crewsafe.mitigation.domain.MitigationSuggestion;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.List;

/**
 * Calls ml-service's {@code POST /agent/draft} (SCRUM-289).
 *
 * <p>Shares {@code bedrockRestTemplate} with {@link BedrockApiClient}, so it inherits the same
 * {@code app.bedrock.bedrock-timeout-ms}. That timeout is 30s rather than the spike's 5s: the
 * SCRUM-287 benchmark measured a p95 of 10.4s for the selected model before any throttling
 * retry, so at 5s this call failed every single time and the deterministic fallback ran while
 * looking exactly like a working LLM path.
 *
 * <p><strong>Every failure is the caller's to absorb, not to propagate.</strong> This class
 * throws on transport failure and lets {@code AgentDraftService} decide what that means,
 * because a supervisor asking for a plan during a heat event must receive one. The graph on the
 * other side already turns model failures into a valid deterministic plan; this client only
 * has to survive ml-service itself being unreachable.
 *
 * <p><strong>Deployment note.</strong> There is no authentication on this call. That is
 * pre-existing (the same is true of {@code /bedrock/suggest}) and acceptable on localhost, but
 * ml-service must not be reachable from outside the deployment boundary until it is addressed.
 * Flagged rather than silently shipped.
 *
 * @author Abu Bakar
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AgentDraftClient {

    private final RestTemplate bedrockRestTemplate;
    private final BedrockProperties properties;

    /**
     * Field names are the ml-service Pydantic model's, verbatim. {@code policyDecision} is
     * non-null by construction at every call site — the agent may not run without one (§8.2),
     * and ml-service rejects a request missing it with a 422 rather than drafting anyway.
     */
    public record DraftRequest(
            String shiftId,
            String siteId,
            double currentWbgt,
            Double forecastWbgt30m,
            String freshness,
            String lightningState,
            List<Worker> workers,
            List<String> contextNotes,
            PolicyDecisionPayload policyDecision) {

        public record Worker(String workerId, String intensity, Integer acclimatisationDay,
                              boolean readinessSubmitted) {
        }

        public record PolicyDecisionPayload(String policyVersion, String currentBand, String forecastBand,
                                             List<Action> mandatoryActions, List<Action> advisoryActions) {
        }

        public record Action(String code, String ruleReference, List<String> appliesTo, String reasoning) {
        }
    }

    /** {@code usedFallback} tells the caller whether the model wrote this or the template did. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record DraftResponse(
            String rationale,
            List<MitigationSuggestion> mitigations,
            String modelId,
            boolean usedFallback,
            String fallbackReason,
            Double forecastWbgt30m,
            String forecastModelVersion,
            int inputTokens,
            int outputTokens) {
    }

    /**
     * @throws BedrockException when ml-service could not be reached or returned something
     *         unusable — never for a model failure, which ml-service handles itself
     */
    public DraftResponse draft(DraftRequest request) {
        String url = properties.getBedrockApiUrl() + "/agent/draft";
        long start = System.currentTimeMillis();

        try {
            DraftResponse response = bedrockRestTemplate.postForObject(url, request, DraftResponse.class);
            if (response == null) {
                throw new BedrockException("ml-service returned an empty agent draft response");
            }

            log.info("agent_draft_received duration_ms={} mitigations={} used_fallback={} tokens={}",
                    System.currentTimeMillis() - start,
                    response.mitigations() == null ? 0 : response.mitigations().size(),
                    response.usedFallback(),
                    response.inputTokens() + response.outputTokens());
            return response;

        } catch (BedrockException e) {
            throw e;
        } catch (Exception e) {
            // Deliberately not logging the exception message: it embeds the ml-service URL and,
            // on some transport failures, request content. The caller logs the outcome.
            log.error("agent_draft_call_failed duration_ms={}", System.currentTimeMillis() - start);
            throw new BedrockException("Failed to reach the ml-service agent", e);
        }
    }
}
