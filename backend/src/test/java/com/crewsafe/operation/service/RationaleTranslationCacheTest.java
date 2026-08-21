package com.crewsafe.operation.service;

import com.crewsafe.operation.domain.RecommendationRationaleTranslation;
import com.crewsafe.operation.repository.RecommendationRationaleTranslationRepository;
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
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The cache write, which is allowed to fail and never allowed to throw.
 *
 * @author Justin Chua
 */
@ExtendWith(MockitoExtension.class)
class RationaleTranslationCacheTest {

    private static final String TAMIL = "வெப்பநிலை 25.3°C ஆக உள்ளது.";
    private static final String HASH = "abc123";

    @Mock
    private RecommendationRationaleTranslationRepository translations;

    @InjectMocks
    private RationaleTranslationCache cache;

    private final UUID recommendationId = UUID.randomUUID();

    @Test
    @DisplayName("a first write inserts a new row")
    void insertsWhenAbsent() {
        when(translations.findByRecommendationIdAndLocale(recommendationId, "ta"))
                .thenReturn(Optional.empty());

        cache.store(recommendationId, "ta", TAMIL, "some-model", HASH);

        ArgumentCaptor<RecommendationRationaleTranslation> saved =
                ArgumentCaptor.forClass(RecommendationRationaleTranslation.class);
        verify(translations).save(saved.capture());
        assertThat(saved.getValue().getTranslatedText()).isEqualTo(TAMIL);
        assertThat(saved.getValue().getLocale()).isEqualTo("ta");
        assertThat(saved.getValue().getSourceHash()).isEqualTo(HASH);
        assertThat(saved.getValue().getId()).isNotNull();
    }

    @Test
    @DisplayName("a re-translation updates the existing row rather than inserting a duplicate")
    void updatesWhenPresent() {
        /*
         * The regenerated-plan path. The unique constraint on (recommendation, locale) means a
         * second insert would fail outright, so this must reuse the row -- and reuse its id, or
         * the update becomes an insert again.
         */
        UUID existingId = UUID.randomUUID();
        RecommendationRationaleTranslation existing = RecommendationRationaleTranslation.builder()
                .id(existingId)
                .recommendationId(recommendationId)
                .locale("ta")
                .translatedText("a translation of the superseded plan")
                .sourceHash("an-old-hash")
                .createdAt(Instant.now())
                .build();
        when(translations.findByRecommendationIdAndLocale(recommendationId, "ta"))
                .thenReturn(Optional.of(existing));

        cache.store(recommendationId, "ta", TAMIL, "some-model", HASH);

        ArgumentCaptor<RecommendationRationaleTranslation> saved =
                ArgumentCaptor.forClass(RecommendationRationaleTranslation.class);
        verify(translations).save(saved.capture());
        assertThat(saved.getValue().getId()).isEqualTo(existingId);
        assertThat(saved.getValue().getTranslatedText()).isEqualTo(TAMIL);
        assertThat(saved.getValue().getSourceHash()).isEqualTo(HASH);
    }

    @Test
    @DisplayName("a failed write is swallowed rather than propagated")
    void writeFailureNeverThrows() {
        // A losing race on the unique constraint. The caller already holds the translation, so
        // failing their read over a duplicate effort would be strictly worse than a cache miss.
        when(translations.findByRecommendationIdAndLocale(recommendationId, "ta"))
                .thenReturn(Optional.empty());
        when(translations.save(any())).thenThrow(new RuntimeException("unique constraint"));

        assertThatCode(() -> cache.store(recommendationId, "ta", TAMIL, "some-model", HASH))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("a failed lookup is swallowed too")
    void lookupFailureInsideStoreNeverThrows() {
        when(translations.findByRecommendationIdAndLocale(recommendationId, "ta"))
                .thenThrow(new RuntimeException("connection reset"));

        assertThatCode(() -> cache.store(recommendationId, "ta", TAMIL, "some-model", HASH))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("find passes through to the repository")
    void findDelegates() {
        when(translations.findByRecommendationIdAndLocale(recommendationId, "ms"))
                .thenReturn(Optional.empty());

        assertThat(cache.find(recommendationId, "ms")).isEmpty();
    }
}
