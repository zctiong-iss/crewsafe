package com.crewsafe.mitigation.ai.bedrock;

import com.crewsafe.mitigation.domain.ActionCatalogue;
import com.crewsafe.mitigation.domain.MitigationSuggestion;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestTemplate;

import java.time.Duration;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The one thing every other test in this ticket mocks away: that the JSON Jackson serialises
 * from {@link AgentDraftClient.DraftRequest} is JSON that ml-service's Pydantic model actually
 * accepts, and that what comes back deserialises into {@link AgentDraftClient.DraftResponse}.
 *
 * <p>A field renamed on one side of that boundary passes every unit test on both sides and
 * fails only in production. This sprint already produced one bug of exactly that shape — the
 * SCRUM-286 model-ID/inference-profile mismatch, invisible to mocked tests because the mock
 * was built from the same wrong assumption the code was.
 *
 * <p><strong>Opt-in, and not part of the suite.</strong> It needs ml-service running with live
 * AWS credentials and makes a billed Bedrock call, so it is skipped unless
 * {@code AGENT_DRAFT_LIVE_TEST=1} is set:
 *
 * <pre>
 * # terminal 1
 * conda activate ml_sandbox
 * AWS_PROFILE=crewsafe AWS_REGION=ap-southeast-1 python -m uvicorn app:app --port 8000
 *
 * # terminal 2
 * AGENT_DRAFT_LIVE_TEST=1 ./mvnw test -Dtest=AgentDraftContractLiveTest
 * </pre>
 *
 * @author Abu Bakar
 */
@EnabledIfEnvironmentVariable(named = "AGENT_DRAFT_LIVE_TEST", matches = "1")
class AgentDraftContractLiveTest {

    private static final String WORKER_A = "11111111-1111-1111-1111-111111111111";
    private static final String WORKER_B = "22222222-2222-2222-2222-222222222222";

    private AgentDraftClient client() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(5));
        factory.setReadTimeout(Duration.ofSeconds(60));

        BedrockProperties properties = new BedrockProperties();
        properties.setBedrockApiUrl(System.getenv().getOrDefault("BEDROCK_API_URL", "http://127.0.0.1:8000"));
        return new AgentDraftClient(new RestTemplate(factory), properties);
    }

    @Test
    @DisplayName("A Java-serialised draft request round-trips through the live ml-service agent")
    void javaRequestRoundTripsThroughTheLiveAgent() {
        AgentDraftClient.DraftResponse response = client().draft(request());

        /*
         * ── FIRST, AND BEFORE ANYTHING ELSE: A MODEL ACTUALLY RAN ───────────────────────
         *
         * Without this the entire test passes with Bedrock completely unavailable, which is
         * the precise failure its own header warns about. ml-service's deterministic fallback
         * (agent/fallback.py) builds its plan straight from the policy decision this request
         * carries, and that plan satisfies every other assertion below: it emits
         * REST_15_MIN_HOURLY with durationMinutes=15/everyMinutes=60 and HYDRATE_HOURLY, a
         * non-blank rationale, known action codes, and a valid origin, ruleReference and
         * category on each mitigation.
         *
         * So a green run proved only that ml-service was up. The one test whose whole purpose
         * is exercising the live model could not distinguish a working Bedrock from a dead one
         * — and this sprint has already produced that exact bug once, when a 5s timeout made
         * every call fall back "while looking exactly like a working LLM path".
         *
         * `modelId` is asserted alongside `usedFallback` because they fail differently: the
         * flag catches ml-service falling back internally, the id catches a response that
         * claims success while naming the fallback sentinel.
         */
        assertThat(response.usedFallback())
                .as("a model must have drafted this; fallbackReason=%s", response.fallbackReason())
                .isFalse();
        assertThat(response.fallbackReason()).isNull();
        assertThat(response.modelId())
                .as("the drafting model must be named")
                .isNotBlank()
                .isNotEqualTo("deterministic-fallback");

        assertThat(response.rationale()).isNotBlank();
        assertThat(response.mitigations()).isNotEmpty();

        // Every mandatory action the policy decision carried must survive the round trip. This
        // is the §8.1 guarantee, asserted against a real model rather than a stub.
        Set<String> drafted = response.mitigations().stream()
                .map(MitigationSuggestion::actionCode)
                .collect(java.util.stream.Collectors.toSet());
        assertThat(drafted).contains("REST_15_MIN_HOURLY", "HYDRATE_HOURLY");

        // Every code must be one the mobile app can translate — the allowlist is a safety
        // property, not a tidiness one (see ActionCatalogue).
        assertThat(response.mitigations())
                .allSatisfy(m -> assertThat(ActionCatalogue.isKnown(m.actionCode()))
                        .as("action code %s is renderable", m.actionCode()).isTrue());

        // The SCRUM-288 fields must deserialise, not silently vanish into ignoreUnknown.
        assertThat(response.mitigations()).allSatisfy(m -> {
            assertThat(m.origin()).isIn("MANDATORY", "ADVISORY");
            assertThat(m.ruleReference()).isNotBlank();
            assertThat(m.category()).isNotBlank();
        });

        // The forecast is currently a persistence baseline, so it equals the current reading.
        // Asserting the version rather than the number is what keeps that honest.
        assertThat(response.forecastWbgt30m()).isEqualTo(32.6);
        assertThat(response.forecastModelVersion()).isEqualTo("baseline-1.0.0");
    }

    @Test
    @DisplayName("Timing survives the round trip: a rest code arrives with its duration and recurrence")
    void timingSurvivesTheRoundTrip() {
        AgentDraftClient.DraftResponse response = client().draft(request());

        MitigationSuggestion rest = response.mitigations().stream()
                .filter(m -> "REST_15_MIN_HOURLY".equals(m.actionCode()))
                .findFirst()
                .orElseThrow();

        assertThat(rest.timing()).isNotNull();
        assertThat(rest.timing().durationMinutes()).isEqualTo(15);
        assertThat(rest.timing().everyMinutes()).isEqualTo(60);
    }

    @Test
    @DisplayName("The band is sent under its wire name, which ml-service validates strictly")
    void bandWireNameIsAccepted() throws Exception {
        // Regression guard for the trap in WbgtBand: the Java constant is BAND_32_TO_BELOW_33
        // but the wire name is 32_TO_BELOW_33, and ml-service's Literal type rejects the other.
        String json = new ObjectMapper().writeValueAsString(request());
        assertThat(json).contains("\"currentBand\":\"32_TO_BELOW_33\"");
        assertThat(json).doesNotContain("BAND_");

        assertThat(client().draft(request()).mitigations()).isNotEmpty();
    }

    private AgentDraftClient.DraftRequest request() {
        return new AgentDraftClient.DraftRequest(
                UUID.randomUUID().toString(),
                UUID.randomUUID().toString(),
                32.6,
                null,
                "LIVE",
                "CLEAR",
                List.of(
                        new AgentDraftClient.DraftRequest.Worker(WORKER_A, "HEAVY", 2, true),
                        new AgentDraftClient.DraftRequest.Worker(WORKER_B, "LIGHT", 9, false)),
                List.of(),
                new AgentDraftClient.DraftRequest.PolicyDecisionPayload(
                        "MOM-WBGT-2026.1",
                        "32_TO_BELOW_33",
                        "32_TO_BELOW_33",
                        List.of(
                                new AgentDraftClient.DraftRequest.Action("REST_15_MIN_HOURLY",
                                        "UNACCLIMATISED_HEAVY_WORK_RULE", List.of(WORKER_A),
                                        "WBGT 32.6C exceeds threshold 21.0C for UNACCLIMATISED worker on HEAVY work"),
                                new AgentDraftClient.DraftRequest.Action("HYDRATE_HOURLY",
                                        "UNACCLIMATISED_HEAVY_WORK_RULE", List.of(WORKER_A, WORKER_B),
                                        "Fluid replacement required at this WBGT")),
                        List.of(
                                new AgentDraftClient.DraftRequest.Action("CLOSE_MONITORING",
                                        "UNACCLIMATISED_HEAVY_WORK_RULE", List.of(WORKER_A, WORKER_B),
                                        "Watch for early signs of heat illness"))));
    }
}
