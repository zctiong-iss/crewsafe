package sg.crewsafe.entity;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "recommendations")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Recommendation {
    @Id
    private UUID id = UUID.randomUUID();

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "shift_id", nullable = false)
    private Shift shift;

    private String policyVersion;

    @Lob
    private String draftPlan; // JSON from agent

    @Column(columnDefinition = "varchar(50) default 'DRAFT'")
    private String status; // DRAFT, PENDING_APPROVAL, APPROVED, REJECTED

    private String rationale;

    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        if (status == null) status = "DRAFT";
    }
}
