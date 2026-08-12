package com.crewsafe.mitigation.domain;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

/**
 * Represents an AI-generated draft plan for heat mitigation operations.
 * Supervisor receives these draft recommendations from the Bedrock agent.
 *
 * @author Surya Kumaraguru
 */
@Entity
@Table(name = "agent_draft_plans")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AgentDraftPlan {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "site_id", nullable = false)
    private UUID siteId;

    @Column(name = "supervisor_id", nullable = false)
    private UUID supervisorId;

    @Column(name = "plan_context", columnDefinition = "TEXT", nullable = false)
    private String planContext;

    @Column(name = "recommended_actions", columnDefinition = "TEXT")
    private String recommendedActions;

    @Column(name = "policy_rules_applied", columnDefinition = "TEXT")
    private String policyRulesApplied;

    @Column(name = "forecast_data_used", columnDefinition = "jsonb")
    private String forecastDataUsed;

    @Column(name = "safety_considerations", columnDefinition = "TEXT")
    private String safetyConsiderations;

    @Column(name = "estimated_duration_minutes")
    private Integer estimatedDurationMinutes;

    @Column(name = "model_id")
    private String modelId;

    @Column(name = "model_version")
    private String modelVersion;

    @Column(name = "approval_status")
    @Enumerated(EnumType.STRING)
    @Builder.Default
    private ApprovalStatus approvalStatus = ApprovalStatus.PENDING;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at")
    private Instant updatedAt;

    @Column(name = "approved_at")
    private Instant approvedAt;

    @PrePersist
    protected void onCreate() {
        createdAt = Instant.now();
        updatedAt = Instant.now();
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }

    /**
     * Approval status for agent-generated draft plans
     */
    public enum ApprovalStatus {
        PENDING,    // Generated, awaiting supervisor review
        APPROVED,   // Supervisor approved the draft
        REJECTED,   // Supervisor rejected the draft
        EXECUTED    // Plan has been dispatched to workers
    }
}
