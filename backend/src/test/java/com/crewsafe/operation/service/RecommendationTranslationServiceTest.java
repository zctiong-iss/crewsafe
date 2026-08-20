package com.crewsafe.operation.service;

import com.crewsafe.mitigation.ai.bedrock.BedrockException;
import com.crewsafe.mitigation.ai.bedrock.RationaleTranslationClient;
import com.crewsafe.operation.domain.Recommendation;
import com.crewsafe.operation.domain.RecommendationRationaleTranslation;
import com.crewsafe.operation.repository.RecommendationRationaleTranslationRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The caching and degrading rules around a translated rationale.
 *
 * <p>Every failure guarded here is silent. A cached failure looks like a translation forever; a
 * stale cache hit looks like a translation of the current plan; a translation that is really
 * English looks like the bug this feature exists to fix. None of them throw, so none of them
 * would be noticed without these.
 *
 * @author Justin Chua
 */
@ExtendWith(MockitoExtension.class)
class RecommendationTranslationServiceTest {

    private static final String ENGLISH =
            "WBGT is 25.3°C, below 31°C, assessed against heat policy MOM-WBGT-2026.1.";
    private static final String TAMIL = "வெப்பநிலை 25.3°C ஆக உள்ளது.";

    @Mock
    private RecommendationRationaleTranslationRepository translations;

    @Mock
    private RationaleTranslationClient translationClient;

    @InjectMocks
    private RecommendationTranslationService service;

    private Recommendation recommendation;

    @BeforeEach
    void setUp() {
        recommendation = new Recommendation();
        recommendation.setId(UUID.randomUUID());
        recommendation.setRationale(ENGLISH);
    }

    private static RationaleTranslationClient.TranslateResponse translated(String text) {
        return new RationaleTranslationClient.TranslateResponse(text, "ta", "some-model", false, null);
    }

    private static RationaleTranslationClient.TranslateResponse degraded() {
        return new RationaleTranslationClient.TranslateResponse(
                ENGLISH, "ta", "none", true, "translation_unavailable: throttled");
    }

    @Test
    @DisplayName("English is served from the stored prose without a model call")
    void englishNeverCallsTheModel() {
        var result = service.rationaleIn(recommendation, "en");

        assertThat(result.text()).isEqualTo(ENGLISH);
        assertThat(result.translated()).isFalse();
        verify(translationClient, never()).translate(anyString(), anyString());
    }

    @Test
    @DisplayName("a miss translates and caches")
    void missTranslatesAndCaches() {
        when(translations.findByRecommendationIdAndLocale(recommendation.getId(), "ta"))
                .thenReturn(Optional.empty());
        when(translationClient.translate(ENGLISH, "ta")).thenReturn(translated(TAMIL));

        var result = service.rationaleIn(recommendation, "ta");

        assertThat(result.text()).isEqualTo(TAMIL);
        assertThat(result.translated()).isTrue();

        ArgumentCaptor<RecommendationRationaleTranslation> saved =
                ArgumentCaptor.forClass(RecommendationRationaleTranslation.class);
        verify(translations).save(saved.capture());
        assertThat(saved.getValue().getTranslatedText()).isEqualTo(TAMIL);
        assertThat(saved.getValue().getLocale()).isEqualTo("ta");
    }

    @Test
    @DisplayName("a hit is served without calling the model again")
    void hitSkipsTheModel() {
        when(translations.findByRecommendationIdAndLocale(recommendation.getId(), "ta"))
                .thenReturn(Optional.of(cachedRow(TAMIL, hashOf(ENGLISH))));

        var result = service.rationaleIn(recommendation, "ta");

        assertThat(result.text()).isEqualTo(TAMIL);
        assertThat(result.translated()).isTrue();
        verify(translationClient, never()).translate(anyString(), anyString());
    }

    @Test
    @DisplayName("a cache entry for a rationale the plan has since replaced is not served")
    void staleCacheIsRefused() {
        /*
         * A regenerated plan overwrites its own rationale. Serving the old translation would
         * show a supervisor an explanation for an assessment that no longer applies -- and it
         * would look completely normal, because it is fluent text in their own language.
         */
        when(translations.findByRecommendationIdAndLocale(recommendation.getId(), "ta"))
                .thenReturn(Optional.of(cachedRow("translation of a superseded plan", "an-old-hash")));
        when(translationClient.translate(ENGLISH, "ta")).thenReturn(translated(TAMIL));

        var result = service.rationaleIn(recommendation, "ta");

        assertThat(result.text()).isEqualTo(TAMIL);
    }

    @Test
    @DisplayName("a degraded response is served but never cached")
    void degradedIsNotCached() {
        /*
         * The response carries the ENGLISH original, not a translation. Caching it would freeze
         * one Bedrock outage into this plan's permanent Tamil text, and nothing would retry.
         */
        when(translations.findByRecommendationIdAndLocale(recommendation.getId(), "ta"))
                .thenReturn(Optional.empty());
        when(translationClient.translate(ENGLISH, "ta")).thenReturn(degraded());

        var result = service.rationaleIn(recommendation, "ta");

        assertThat(result.text()).isEqualTo(ENGLISH);
        assertThat(result.translated()).isFalse();
        verify(translations, never()).save(any());
    }

    @Test
    @DisplayName("an unreachable ml-service degrades to English rather than failing the read")
    void transportFailureDegrades() {
        // Section 7.1. A supervisor being asked to approve a plan must not lose the explanation
        // entirely because a translator is down.
        when(translations.findByRecommendationIdAndLocale(recommendation.getId(), "ta"))
                .thenReturn(Optional.empty());
        when(translationClient.translate(ENGLISH, "ta"))
                .thenThrow(new BedrockException("connection refused"));

        var result = service.rationaleIn(recommendation, "ta");

        assertThat(result.text()).isEqualTo(ENGLISH);
        assertThat(result.translated()).isFalse();
        verify(translations, never()).save(any());
    }

    @Test
    @DisplayName("a losing race on the cache write still returns the translation")
    void cacheWriteFailureDoesNotFailTheRead() {
        // Two readers opening the same plan in the same language at once. Both hold a valid
        // translation, so the duplicate effort must not surface as an error.
        when(translations.findByRecommendationIdAndLocale(recommendation.getId(), "ta"))
                .thenReturn(Optional.empty());
        when(translationClient.translate(ENGLISH, "ta")).thenReturn(translated(TAMIL));
        when(translations.save(any())).thenThrow(new RuntimeException("unique constraint"));

        var result = service.rationaleIn(recommendation, "ta");

        assertThat(result.text()).isEqualTo(TAMIL);
        assertThat(result.translated()).isTrue();
    }

    @Test
    @DisplayName("a plan with no rationale yields nothing rather than a model call")
    void blankRationaleShortCircuits() {
        recommendation.setRationale("   ");

        var result = service.rationaleIn(recommendation, "ta");

        assertThat(result.text()).isEmpty();
        verify(translationClient, never()).translate(anyString(), anyString());
    }

    @Test
    @DisplayName("the supported locales are exactly the seven the app ships")
    void supportedLocalesMatchTheApp() {
        for (String locale : new String[]{"en", "zh-Hans", "ms", "ta", "hi", "bn", "my"}) {
            assertThat(RecommendationTranslationService.isSupportedLocale(locale))
                    .as("locale %s", locale)
                    .isTrue();
        }
        assertThat(RecommendationTranslationService.isSupportedLocale("fr")).isFalse();
        assertThat(RecommendationTranslationService.isSupportedLocale(null)).isFalse();
    }

    private RecommendationRationaleTranslation cachedRow(String text, String sourceHash) {
        return RecommendationRationaleTranslation.builder()
                .id(UUID.randomUUID())
                .recommendationId(recommendation.getId())
                .locale("ta")
                .translatedText(text)
                .modelId("some-model")
                .sourceHash(sourceHash)
                .createdAt(Instant.now())
                .build();
    }

    /** Mirrors the service's own hashing, so a cache hit can be set up honestly. */
    private static String hashOf(String source) {
        try {
            var digest = java.security.MessageDigest.getInstance("SHA-256");
            return java.util.HexFormat.of()
                    .formatHex(digest.digest(source.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
