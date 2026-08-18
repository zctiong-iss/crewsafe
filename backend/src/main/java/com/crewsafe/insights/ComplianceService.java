package com.crewsafe.insights;

import com.crewsafe.insights.ComplianceReport.ComplianceBucket;
import com.crewsafe.insights.ComplianceReport.ResponseTimeBucket;
import com.crewsafe.operation.domain.ActionDispatch;
import com.crewsafe.operation.domain.ActionDispatch.ActionDispatchStatus;
import com.crewsafe.operation.domain.ActionDispatch.CompletionSource;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.TreeMap;
import java.util.UUID;

/**
 * Builds the SCRUM-433 compliance report: how dispatched safety actions resolved at a site over a
 * window, and how quickly workers acknowledged them.
 *
 * <p>The outcome partition is the report's core rule. A dispatched action is <em>acted on</em> when
 * a person answered it (acknowledged, or completed it themselves) and <em>lapsed</em> when the
 * automatic sweep had to step in (it went LATE, or the system auto-completed it). A still-PENDING
 * dispatch is neither — it has not been answered <em>yet</em> — so it is left out of the totals
 * entirely, which is what keeps {@code actedOn + lapsed == dispatched} true.
 *
 * @author Tang Chee Seng
 */
@Service
@RequiredArgsConstructor
public class ComplianceService {

    /** Fixed latency bands (upper bound in seconds, last open-ended), always emitted in order so
     *  the histogram keeps a stable x-axis even when a band is empty. */
    private static final List<Band> BANDS = List.of(
            new Band("0–1m", 60),
            new Band("1–2m", 120),
            new Band("2–5m", 300),
            new Band("5–10m", 600),
            new Band("10m+", Integer.MAX_VALUE));

    private static final DateTimeFormatter DAY_LABEL =
            DateTimeFormatter.ofPattern("EEE d", Locale.ENGLISH);

    private final ComplianceQueryRepository dispatches;
    private final SiteRepository sites;

    public ComplianceReport report(UUID siteId, Instant from, Instant to) {
        ZoneId zone = sites.findById(siteId)
                .map(Site::getTimezone)
                .map(ZoneId::of)
                .orElse(ZoneId.of("Asia/Singapore"));

        List<ActionDispatch> rows = dispatches.findDispatchesForSite(siteId, from, to);

        // Day buckets, oldest first. TreeMap keeps calendar order without a separate sort.
        TreeMap<LocalDate, int[]> byDay = new TreeMap<>();  // [actedOn, lapsed]
        int actedOn = 0;
        int lapsed = 0;
        for (ActionDispatch row : rows) {
            Outcome outcome = classify(row.getStatus(), row.getCompletedBy());
            if (outcome == Outcome.PENDING) {
                continue;  // unresolved — not part of the compliance rate yet
            }
            LocalDate day = row.getDispatchedAt().atZone(zone).toLocalDate();
            int[] tally = byDay.computeIfAbsent(day, d -> new int[2]);
            if (outcome == Outcome.ACTED_ON) {
                actedOn++;
                tally[0]++;
            } else {
                lapsed++;
                tally[1]++;
            }
        }

        int dispatched = actedOn + lapsed;
        double complianceRate = dispatched == 0 ? 0.0 : (double) actedOn / dispatched;

        List<ComplianceBucket> compliance = new ArrayList<>();
        byDay.forEach((day, tally) -> compliance.add(
                new ComplianceBucket(day.format(DAY_LABEL), tally[0] + tally[1], tally[0], tally[1])));

        List<Double> responseSeconds = new ArrayList<>(dispatches.findAckResponseSeconds(siteId, from, to));
        responseSeconds.sort(Double::compareTo);

        return new ComplianceReport(siteId, from, to, dispatched, actedOn, lapsed, complianceRate,
                percentile(responseSeconds, 50), percentile(responseSeconds, 95),
                compliance, histogram(responseSeconds));
    }

    /**
     * The resolved-outcome of one dispatch.
     *
     * <p>{@code lapsed} first: a LATE status or a SYSTEM completion both mean the sweep intervened,
     * regardless of anything else. Only then is a human answer counted — an ACKNOWLEDGED dispatch,
     * or one a WORKER completed (a SYSTEM completion was already caught above). Anything left is
     * still PENDING, and therefore unresolved.
     */
    private static Outcome classify(ActionDispatchStatus status, CompletionSource completedBy) {
        if (status == ActionDispatchStatus.LATE || completedBy == CompletionSource.SYSTEM) {
            return Outcome.LAPSED;
        }
        if (status == ActionDispatchStatus.ACKNOWLEDGED || status == ActionDispatchStatus.COMPLETED) {
            return Outcome.ACTED_ON;
        }
        return Outcome.PENDING;
    }

    /** Nearest-rank percentile over an already-sorted list; null when there is nothing to rank. */
    private static Double percentile(List<Double> sorted, double p) {
        if (sorted.isEmpty()) {
            return null;
        }
        int rank = (int) Math.ceil(p / 100.0 * sorted.size());
        return sorted.get(Math.clamp(rank, 1, sorted.size()) - 1);
    }

    /** Folds sorted response times into the fixed latency bands. */
    private static List<ResponseTimeBucket> histogram(List<Double> sortedSeconds) {
        List<ResponseTimeBucket> buckets = new ArrayList<>();
        for (Band band : BANDS) {
            buckets.add(new ResponseTimeBucket(band.label(), 0));
        }
        for (double seconds : sortedSeconds) {
            for (int i = 0; i < BANDS.size(); i++) {
                if (seconds < BANDS.get(i).upperExclusiveSeconds()) {
                    ResponseTimeBucket current = buckets.get(i);
                    buckets.set(i, new ResponseTimeBucket(current.label(), current.count() + 1));
                    break;
                }
            }
        }
        return buckets;
    }

    private enum Outcome { ACTED_ON, LAPSED, PENDING }

    private record Band(String label, int upperExclusiveSeconds) {
    }
}
