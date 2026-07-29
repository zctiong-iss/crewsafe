package sg.crewsafe.entity;

import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "weather_observations")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class WeatherObservation {
    @Id
    private UUID id = UUID.randomUUID();

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "site_id", nullable = false)
    private Site site;

    private BigDecimal wbgt;
    private BigDecimal temperature;
    private BigDecimal humidity;
    private BigDecimal windSpeed;
    private BigDecimal rainfall;

    private LocalDateTime observedAt;
    private LocalDateTime ingestedAt;

    @Column(columnDefinition = "varchar(50) default 'NEA'")
    private String source; // NEA, MANUAL, CACHED

    @Column(columnDefinition = "varchar(50) default 'LIVE'")
    private String qualityStatus; // LIVE, DELAYED, STALE, SIMULATED

    private String stationId;

    @PrePersist
    protected void onCreate() {
        if (ingestedAt == null) ingestedAt = LocalDateTime.now();
        if (source == null) source = "NEA";
        if (qualityStatus == null) qualityStatus = "LIVE";
    }
}
