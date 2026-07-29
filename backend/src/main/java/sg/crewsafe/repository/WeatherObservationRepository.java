package sg.crewsafe.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;
import sg.crewsafe.entity.WeatherObservation;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface WeatherObservationRepository extends JpaRepository<WeatherObservation, UUID> {

    @Query("SELECT w FROM WeatherObservation w WHERE w.site.id = ?1 ORDER BY w.observedAt DESC LIMIT 1")
    Optional<WeatherObservation> findLatestBySiteId(UUID siteId);

    List<WeatherObservation> findBySiteIdOrderByObservedAtDesc(UUID siteId);

    List<WeatherObservation> findBySiteIdAndObservedAtBetweenOrderByObservedAtDesc(
        UUID siteId, LocalDateTime startTime, LocalDateTime endTime);
}
