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

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    public enum RecommendationStatus {
        DRAFT,
        PENDING_APPROVAL,
        APPROVED,
        REJECTED
    }
}
