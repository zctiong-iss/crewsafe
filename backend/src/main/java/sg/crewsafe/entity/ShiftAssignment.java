package sg.crewsafe.entity;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "shift_assignments")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ShiftAssignment {
    @Id
    private UUID id = UUID.randomUUID();

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "shift_id", nullable = false)
    private Shift shift;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "worker_id", nullable = false)
    private User worker;

    private String taskName; // "Landscaping", "Maintenance", etc.

    @Column(columnDefinition = "varchar(20) default 'MODERATE'")
    private String intensity; // LIGHT, MODERATE, HEAVY

    private Integer acclimatisationDay; // 1-7, null if acclimatised

    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        if (intensity == null) intensity = "MODERATE";
    }
}
