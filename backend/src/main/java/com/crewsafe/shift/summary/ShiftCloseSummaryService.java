package com.crewsafe.shift.summary;

import com.crewsafe.audit.AuditEventTypeCount;
import com.crewsafe.audit.AuditExportRepository;
import com.crewsafe.common.audit.AuditEvent;
import com.crewsafe.common.audit.AuditEventRepository;
import com.crewsafe.common.audit.AuditEventType;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.service.ShiftService;
import com.crewsafe.shift.summary.ShiftCloseSummaryResponse.Actions;
import com.crewsafe.shift.summary.ShiftCloseSummaryResponse.Conditions;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import com.crewsafe.weather.domain.WbgtBand;
import com.crewsafe.weather.repository.WeatherObservationRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Assembles the SCRUM-139 (US-44) close-out summary for one shift. Every countable figure comes
 * from the shift's own audit rows via {@link AuditExportRepository#countByEventTypeForShift}, so
 * the summary reconciles with the trail by construction (see {@link ShiftCloseSummaryResponse}).
 * The non-counted context — peak heat band, who closed the shift — is read from the same trail
 * ({@code SHIFT_CLOSED}) and the weather observations, never from a second bookkeeping field.
 *
 * @author Tang Chee Seng
 */
@Service
@RequiredArgsConstructor
public class ShiftCloseSummaryService {

    private final ShiftService shifts;
    private final AuditExportRepository auditRows;
    private final AuditEventRepository auditEvents;
    private final AppUserRepository users;
    private final SiteRepository sites;
    private final WeatherObservationRepository weather;

    /** Empty when no shift with this id exists under this site — the caller renders 404. */
    public Optional<ShiftCloseSummaryResponse> summarise(UUID siteId, UUID shiftId) {
        return shifts.getShift(siteId, shiftId).map(shift -> build(siteId, shiftId, shift));
    }

    private ShiftCloseSummaryResponse build(UUID siteId, UUID shiftId, Shift shift) {
        Map<String, Long> counts = countsByType(shiftId);
        long totalAuditEvents = counts.values().stream().mapToLong(Long::longValue).sum();

        BigDecimal peakWbgt = weather.findMaxWbgt(siteId, shift.getStartsAt(), shift.getEndsAt());
        Conditions conditions = new Conditions(
                intCount(counts, AuditEventType.READINESS_SUBMITTED), peakWbgt, WbgtBand.classify(peakWbgt));

        Optional<AuditEvent> closed =
                auditEvents.findFirstByEventTypeAndTargetIdOrderByOccurredAtDesc(AuditEventType.SHIFT_CLOSED, shiftId);
        Instant closedAt = closed.map(AuditEvent::getOccurredAt).orElse(null);
        String closedByName = closed.map(AuditEvent::getActorId).flatMap(users::findById)
                .map(AppUser::getDisplayName).orElse(null);

        String siteName = sites.findById(siteId).map(Site::getName).orElse(null);

        return new ShiftCloseSummaryResponse(
                shiftId, siteId, siteName,
                shift.getStartsAt(), shift.getEndsAt(), shift.getStatus().name(),
                shifts.localRange(siteId, shift.getStartsAt(), shift.getEndsAt()),
                shifts.assignmentsFor(shiftId).size(),
                closedAt, closedByName,
                conditions, Actions.from(counts),
                totalAuditEvents, counts);
    }

    /** Insertion-ordered so the JSON breakdown reads in a stable order across calls. */
    private Map<String, Long> countsByType(UUID shiftId) {
        Map<String, Long> counts = new LinkedHashMap<>();
        for (AuditEventTypeCount row : auditRows.countByEventTypeForShift(shiftId)) {
            counts.put(row.getEventType(), row.getTotal());
        }
        return counts;
    }

    private static int intCount(Map<String, Long> counts, String eventType) {
        return Math.toIntExact(counts.getOrDefault(eventType, 0L));
    }
}
