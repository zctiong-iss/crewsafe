package com.crewsafe.operation.domain;

import com.crewsafe.identity.domain.AppUser;
import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * JPA entity for approval - represents a supervisor's decision on a recommendation.
 *
 * @author Surya Kumaraguru
 */
@Entity
@Table(name = "approval")
@Getter
@Setter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class Approval {
    @Id
    private UUID id;

    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "recommendation_id", nullable = false, unique = true)
    private Recommendation recommendation;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "approver_id", nullable = false)
    private AppUser approver;

    @Enumerated(EnumType.STRING)
    @Column(name = "decision", nullable = false)
    private ApprovalDecision decision;

    @Column(name = "reason")
    private String reason;

    @Column(name = "edited_plan")
    private String editedPlan;

    @Column(name = "decided_at", nullable = false)
    private Instant decidedAt;

    public enum ApprovalDecision {
        APPROVED,
        REJECTED,
        EDITED
    }
}
