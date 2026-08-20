package com.crewsafe.operation.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * One recommendation's rationale, restated in one locale.
 *
 * <p>Keyed on the pair rather than hung off the recommendation, because a plan is drafted once
 * and read by many people who may each have a different language set. The same plan legitimately
 * needs to exist in several languages at once.
 *
 * <p>Holds a plain {@code recommendationId} rather than a {@code @ManyToOne}. This is a cache
 * row read and written on its own; mapping the association would pull a Recommendation graph
 * into every lookup for no benefit, and the foreign key in V26 enforces the relationship where
 * it matters.
 *
 * @author Justin Chua
 */
@Entity
@Table(name = "recommendation_rationale_translation")
@Getter
@Setter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class RecommendationRationaleTranslation {

    @Id
    private UUID id;

    @Column(name = "recommendation_id", nullable = false)
    private UUID recommendationId;

    @Column(name = "locale", nullable = false, length = 16)
    private String locale;

    @Column(name = "translated_text", nullable = false, columnDefinition = "TEXT")
    private String translatedText;

    @Column(name = "model_id", length = 200)
    private String modelId;

    /**
     * Hash of the English rationale this was translated from.
     *
     * <p>A regenerated plan overwrites its own rationale, at which point every translation of
     * the previous one says something the plan no longer says -- and a supervisor reading in
     * Tamil would be approving on an explanation for a superseded assessment. Comparing hashes
     * on read catches that without an invalidation step somebody has to remember to call.
     */
    @Column(name = "source_hash", nullable = false, length = 64)
    private String sourceHash;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;
}
