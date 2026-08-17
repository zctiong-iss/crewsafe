package com.crewsafe.operation.domain;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

/**
 * JPA entity for recommendation - represents an AI-generated recommendation for shift actions.
 *
 * @author Surya Kumaraguru
 */
@Entity
@Table(name = "recommendation")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Recommendation {
    @Id
    private UUID id;

    @Column(name = "shift_id", nullable = false)
    private UUID shiftId;

    @Column(name = "policy_version")
    private String policyVersion;

    @Column(name = "draft_plan")
    private String draftPlan;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private RecommendationStatus status;

    @Column(name = "rationale")
    private String rationale;

    /**
     * Serialised {@link RecommendationEvidence} — the conditions at draft time (SCRUM-359).
     * Null on rows drafted before it existed; clients must render that as "not recorded"
     * rather than substituting current readings.
     */
    @Column(name = "evidence")
    private String evidence;

    /**
     * The Bedrock model that drafted this plan, or a deterministic-fallback sentinel when no
     * model was involved (SCRUM-359, satisfying §12.2's model-version requirement). Never the
     * configured model id when the model's output was discarded — a plan the model did not
     * write must not be attributed to it.
     */
    @Column(name = "model_version")
    private String modelVersion;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    public enum RecommendationStatus {
        DRAFT,
        PENDING_APPROVAL,
        APPROVED,
        REJECTED,

        /**
         * A newer auto-triggered draft replaced this one before a supervisor decided on it
         * (SCRUM-291) -- dedup, not rejection: nobody looked at this plan and said no, the
         * conditions it was drafted under simply changed first. {@code RecommendationService
         * #decide} refuses a decision on a recommendation in this state.
         */
        SUPERSEDED,

        /**
         * A lightning-immediate or WBGT-max stop-work (SCRUM-440): dispatched straight to
         * workers with no supervisor approval step at all, per the team's four-rule alert
         * policy. Terminal, like APPROVED/REJECTED, but reached without an {@link Approval}
         * ever existing -- see {@code AgentDraftService#doGenerate} for the two conditions
         * that reach it and {@code RecommendationService#assertCanDecide} for why one can no
         * longer be decided on.
         */
        AUTO_DISPATCHED
    }
}
