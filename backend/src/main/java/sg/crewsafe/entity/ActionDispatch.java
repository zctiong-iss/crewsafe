package sg.crewsafe.entity;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "action_dispatches")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ActionDispatch {
    @Id
    private UUID id = UUID.randomUUID();

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "approval_id", nullable = false)
    private Approval approval;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "worker_id", nullable = false)
    private User worker;

    private String actionCode; // REST_10_MIN, REST_15_MIN, HYDRATE, STOP_WORK

    private String instruction;

    private LocalDateTime startTime;
    private LocalDateTime endTime;

    @Column(columnDefinition = "varchar(50) default 'PENDING'")
    private String status; // PENDING, ACKNOWLEDGED, COMPLETED

    private LocalDateTime dispatchedAt;

    @PrePersist
    protected void onCreate() {
        if (dispatchedAt == null) dispatchedAt = LocalDateTime.now();
        if (status == null) status = "PENDING";
    }
}
