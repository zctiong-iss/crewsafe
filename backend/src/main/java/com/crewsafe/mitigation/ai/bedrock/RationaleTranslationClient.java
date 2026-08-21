package com.crewsafe.mitigation.ai.bedrock;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

/**
 * Calls ml-service's {@code POST /agent/translate}.
 *
 * <p>Shares {@code bedrockRestTemplate} with {@link AgentDraftClient}, so it inherits the same
 * generous timeout. That is the right default here: a translation is longer in output than the
 * rationale it restates, particularly in Tamil, Hindi, Bengali and Burmese.
 *
 * <p><strong>What may be sent through here.</strong> A recommendation's own stored rationale
 * and nothing else. That text reaches a language model inside a prompt, so routing
 * worker-entered text through it would open the prompt-injection path the ml-service contract
 * documents on {@code contextNotes}. The prompt on the far side treats its input as data rather
 * than as instructions, but that is defence in depth and not a licence to widen the input.
 *
 * <p><strong>Deployment note.</strong> Like {@link AgentDraftClient}, this call is
 * unauthenticated. Pre-existing and acceptable on localhost; ml-service must not be reachable
 * from outside the deployment boundary.
 *
 * @author Justin Chua
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class RationaleTranslationClient {

    private final RestTemplate bedrockRestTemplate;
    private final BedrockProperties properties;

    /** Field names are the ml-service Pydantic model's, verbatim. */
    public record TranslateRequest(String text, String targetLocale) {
    }

    /**
     * {@code usedFallback} true means the text came back untranslated.
     *
     * <p>The caller must still render it -- taking the explanation away from a supervisor who
     * is being asked to approve a plan is the worse failure (§7.1) -- but must never store it.
     * Caching one outage would freeze English into that plan permanently.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record TranslateResponse(
            String text,
            String targetLocale,
            String modelId,
            boolean usedFallback,
            String fallbackReason) {
    }

    /**
     * @throws BedrockException when ml-service could not be reached or returned something
     *         unusable -- never for a model failure, which ml-service turns into a
     *         {@code usedFallback} response rather than an error
     */
    public TranslateResponse translate(String text, String targetLocale) {
        String url = properties.getBedrockApiUrl() + "/agent/translate";
        long start = System.currentTimeMillis();

        try {
            TranslateResponse response = bedrockRestTemplate.postForObject(
                    url, new TranslateRequest(text, targetLocale), TranslateResponse.class);
            if (response == null) {
                throw new BedrockException("ml-service returned an empty translation response");
            }

            log.info("rationale_translation_received duration_ms={} locale={} used_fallback={}",
                    System.currentTimeMillis() - start, targetLocale, response.usedFallback());
            return response;

        } catch (BedrockException e) {
            throw e;
        } catch (Exception e) {
            // Message deliberately omitted: it embeds the ml-service URL and, on some transport
            // failures, the request body -- which here is plan content.
            log.error("rationale_translation_call_failed duration_ms={} locale={}",
                    System.currentTimeMillis() - start, targetLocale);
            throw new BedrockException("Failed to reach the ml-service translator", e);
        }
    }
}
