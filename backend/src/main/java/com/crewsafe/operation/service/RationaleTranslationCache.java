package com.crewsafe.operation.service;

import com.crewsafe.operation.domain.RecommendationRationaleTranslation;
import com.crewsafe.operation.repository.RecommendationRationaleTranslationRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * Reads and writes the per-locale rationale cache, each write in its own transaction.
 *
 * <p><strong>Why this is a separate bean rather than two methods on
 * {@link RecommendationTranslationService}.</strong> The write has to be allowed to fail without
 * taking the read down with it -- two readers opening the same plan in the same language race on
 * the unique constraint, and both of them are holding a perfectly good translation.
 *
 * <p>Catching the exception in the caller does not achieve that. A failed JPA write marks the
 * surrounding transaction rollback-only, so a caught-and-ignored constraint violation still
 * surfaces as {@code UnexpectedRollbackException} at commit -- turning a duplicate effort into a
 * failed read, which is the opposite of the intent. The write needs a transaction of its own,
 * and {@code REQUIRES_NEW} only applies when the call arrives through the proxy. A private
 * method or a self-invoking overload would be silently ignored.
 *
 * @author Justin Chua
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class RationaleTranslationCache {

    private final RecommendationRationaleTranslationRepository translations;

    @Transactional(readOnly = true)
    public Optional<RecommendationRationaleTranslation> find(UUID recommendationId, String locale) {
        return translations.findByRecommendationIdAndLocale(recommendationId, locale);
    }

    /**
     * Stores a translation, or gives up quietly.
     *
     * <p>Never throws. The caller already has the translation in hand, so a cache miss on the
     * next read costs one extra model call -- cheap next to failing a plan read a supervisor is
     * waiting on.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void store(UUID recommendationId, String locale, String text, String modelId, String sourceHash) {
        try {
            RecommendationRationaleTranslation row =
                    translations.findByRecommendationIdAndLocale(recommendationId, locale)
                            .orElseGet(() -> RecommendationRationaleTranslation.builder()
                                    .id(UUID.randomUUID())
                                    .recommendationId(recommendationId)
                                    .locale(locale)
                                    .build());

            row.setTranslatedText(text);
            row.setModelId(modelId);
            row.setSourceHash(sourceHash);
            row.setCreatedAt(Instant.now());
            translations.save(row);
        } catch (Exception e) {
            // Most likely a losing race on the unique constraint. Only this transaction rolls
            // back; the caller's read is untouched.
            log.warn("rationale_translation_not_cached locale={} recommendation={}", locale, recommendationId);
        }
    }
}
