package com.crewsafe.operation.service;

import com.crewsafe.mitigation.ai.bedrock.RationaleTranslationClient;
import com.crewsafe.operation.domain.Recommendation;
import com.crewsafe.operation.domain.RecommendationRationaleTranslation;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * A plan's rationale, in the language the reader set.
 *
 * <p><strong>Why this exists at all,</strong> given the client already builds a localised
 * summary from structured evidence: that summary covers what the policy engine decided, which
 * is reconstructible. It cannot cover what the language model actually reasoned. That paragraph
 * is free prose with no structured inputs behind it, so no client can rebuild it, and leaving
 * it in English asks a supervisor to approve a plan on an explanation they cannot read.
 *
 * <p><strong>Why on demand.</strong> A plan is drafted once and read many times, in the two or
 * three languages a crew actually uses. Translating all seven at draft time would spend roughly
 * seven times the output tokens, six of them on nobody, and would put that latency on a path
 * that may be issuing a stop-work.
 *
 * @author Justin Chua
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class RecommendationTranslationService {

    /** Mirrors ml-service's {@code TargetLocale} and the app's shipped locale files. */
    private static final List<String> SUPPORTED_LOCALES =
            List.of("en", "zh-Hans", "ms", "ta", "hi", "bn", "my");

    private static final String SOURCE_LANGUAGE = "en";

    private final RationaleTranslationCache cache;
    private final RationaleTranslationClient translationClient;

    public static boolean isSupportedLocale(String locale) {
        return locale != null && SUPPORTED_LOCALES.contains(locale);
    }

    /**
     * What a client renders, and whether it is actually a translation.
     *
     * <p>{@code translated} false means the caller is looking at English. It is reported rather
     * than hidden so the client can label it as the model's original wording instead of letting
     * it read as a translation failure -- the difference between degrading and lying.
     */
    public record TranslatedRationale(String text, String locale, boolean translated) {
    }

    /**
     * The rationale for {@code recommendation} in {@code locale}, from cache where possible.
     *
     * <p>Never throws for a translation failure. The caller is rendering a plan a supervisor is
     * being asked to approve, and §7.1 says a degraded read beats a failed one: an unreachable
     * ml-service returns the English original with {@code translated=false}, which the client
     * shows under its existing "the model's original wording" label.
     *
     * <p>Deliberately NOT transactional. The read needs no transaction of its own, and wrapping
     * it in one would make a failed cache write poison the read: a failed JPA write marks the
     * surrounding transaction rollback-only, so catching the exception is not enough to keep the
     * commit alive. {@link RationaleTranslationCache} owns that write in its own transaction.
     */
    public TranslatedRationale rationaleIn(Recommendation recommendation, String locale) {
        String source = recommendation.getRationale();
        if (source == null || source.isBlank()) {
            return new TranslatedRationale("", locale, false);
        }
        if (SOURCE_LANGUAGE.equals(locale)) {
            return new TranslatedRationale(source, locale, false);
        }

        String sourceHash = hash(source);
        Optional<RecommendationRationaleTranslation> cached =
                cache.find(recommendation.getId(), locale);

        /*
         * A cached row whose hash no longer matches was translated from a rationale this plan
         * has since replaced -- a regenerated plan overwrites its own. Serving it would show a
         * supervisor an explanation for an assessment that no longer applies, which is worse
         * than showing them English.
         */
        if (cached.isPresent() && sourceHash.equals(cached.get().getSourceHash())) {
            return new TranslatedRationale(cached.get().getTranslatedText(), locale, true);
        }

        RationaleTranslationClient.TranslateResponse response;
        try {
            response = translationClient.translate(source, locale);
        } catch (Exception e) {
            log.warn("rationale_translation_unavailable locale={} recommendation={}",
                    locale, recommendation.getId());
            return new TranslatedRationale(source, locale, false);
        }

        /*
         * A fallback response carries the ENGLISH original, not a translation. Storing it would
         * cache one Bedrock outage as this plan's permanent Tamil text, and nothing would ever
         * retry.
         */
        if (response.usedFallback()) {
            log.info("rationale_translation_degraded locale={} reason={}", locale, response.fallbackReason());
            return new TranslatedRationale(source, locale, false);
        }

        cache.store(recommendation.getId(), locale, response.text(), response.modelId(), sourceHash);
        return new TranslatedRationale(response.text(), locale, true);
    }

    /** SHA-256 of the source prose. Identity only -- nothing here is a security boundary. */
    private static String hash(String source) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(source.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is required by the Java platform", e);
        }
    }
}
