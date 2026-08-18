package com.crewsafe.shift.service;

import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.shift.api.ReadinessSummaryResponse;
import com.crewsafe.shift.api.ReadinessSummaryResponse.ReadinessStatus;
import com.crewsafe.shift.api.ReadinessSummaryResponse.ShiftReadiness;
import com.crewsafe.shift.api.ReadinessSummaryResponse.WorkerReadiness;
import com.crewsafe.shift.domain.ReadinessSubmission;
import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.domain.ShiftAssignment;
import com.crewsafe.shift.domain.ShiftStatus;
import com.crewsafe.shift.domain.SymptomFlag;
import com.crewsafe.shift.repository.ReadinessSubmissionRepository;
import com.crewsafe.shift.repository.ShiftAssignmentRepository;
import com.crewsafe.shift.repository.ShiftRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Assembles the SCRUM-437 supervisor readiness summary: for every upcoming shift at a site,
 * which rostered workers have cleared the pre-shift readiness check, which are stale, and
 * which are missing entirely.
 *
 * <p>Reads are batched (one roster query, one name query for the whole board) so a site with
 * several upcoming shifts does not fan out into N+1 queries — the same shape as
 * {@code ActionStatusSnapshotService} and the wellbeing summary. Only the per-worker "latest
 * submission" stays per-worker, because it needs the {@code OrderBy…Desc} recency semantics
 * that a batch {@code IN} query cannot express.
 *
 * @author Tang Chee Seng
 */
@Service
@RequiredArgsConstructor
public class ReadinessSummaryService {

    /** The board only shows shifts still ahead of or in progress — never CLOSED/CANCELLED. */
    private static final List<ShiftStatus> UPCOMING = List.of(ShiftStatus.PLANNED, ShiftStatus.ACTIVE);

    private final ShiftRepository shifts;
    private final ShiftAssignmentRepository assignments;
    private final ReadinessSubmissionRepository submissions;
    private final AppUserRepository users;
    private final Clock clock;

    /**
     * How old a submission may be before it reads as {@code STALE} rather than {@code SUBMITTED}.
     * Default 16h (a long shift plus a margin) — <strong>flag to the policy owner (Abu Bakar):
     * this is a placeholder, not a ratified figure.</strong> Overridable via
     * {@code crewsafe.readiness.freshness-window} as an ISO-8601 duration (e.g. {@code PT16H}).
     */
    @Value("${crewsafe.readiness.freshness-window:PT16H}")
    private Duration freshnessWindow;

    public ReadinessSummaryResponse summarise(UUID siteId) {
        Instant now = Instant.now(clock);
        List<Shift> upcoming = shifts.findBySiteIdAndStatusInOrderByStartsAtAscIdAsc(siteId, UPCOMING);

        List<UUID> shiftIds = upcoming.stream().map(Shift::getId).toList();
        Map<UUID, List<ShiftAssignment>> rosterByShift = assignments.findByShiftIdIn(shiftIds).stream()
                .collect(Collectors.groupingBy(ShiftAssignment::getShiftId));
        Map<UUID, String> nameByWorker = resolveNames(rosterByShift);

        List<ShiftReadiness> shiftReadiness = upcoming.stream()
                .map(shift -> buildShift(shift, rosterByShift.getOrDefault(shift.getId(), List.of()),
                        nameByWorker, now))
                .toList();

        return new ReadinessSummaryResponse(siteId, shiftReadiness);
    }

    /** One batch name lookup across every rostered worker on the whole board. */
    private Map<UUID, String> resolveNames(Map<UUID, List<ShiftAssignment>> rosterByShift) {
        List<UUID> workerIds = rosterByShift.values().stream()
                .flatMap(List::stream)
                .map(ShiftAssignment::getWorkerId)
                .distinct()
                .toList();
        return users.findAllById(workerIds).stream()
                .collect(Collectors.toMap(AppUser::getId, AppUser::getDisplayName));
    }

    private ShiftReadiness buildShift(Shift shift, List<ShiftAssignment> roster,
            Map<UUID, String> nameByWorker, Instant now) {

        List<WorkerReadiness> workers = roster.stream()
                .sorted(Comparator.comparing(a -> nameByWorker.getOrDefault(a.getWorkerId(), "")))
                .map(assignment -> {
                    Optional<ReadinessSubmission> latest = submissions
                            .findFirstByShiftIdAndWorkerIdOrderBySubmittedAtDescIdDesc(
                                    shift.getId(), assignment.getWorkerId());
                    String name = nameByWorker.getOrDefault(assignment.getWorkerId(), "Unknown worker");
                    return classify(assignment.getWorkerId(), name, latest, now);
                })
                .toList();

        Map<ReadinessStatus, Long> tally = workers.stream()
                .collect(Collectors.groupingBy(WorkerReadiness::status, Collectors.counting()));

        return new ShiftReadiness(
                shift.getId(), shift.getStartsAt(), shift.getEndsAt(), shift.getStatus().name(),
                tally.getOrDefault(ReadinessStatus.SUBMITTED, 0L).intValue(),
                tally.getOrDefault(ReadinessStatus.STALE, 0L).intValue(),
                tally.getOrDefault(ReadinessStatus.MISSING, 0L).intValue(),
                workers);
    }

    /**
     * Classifies one rostered worker against the readiness check.
     *
     * <ul>
     *   <li><b>MISSING</b> — no submission at all. {@code fitToWork} and {@code submittedAt} are
     *       null (nothing to read them from); {@code flaggedSymptom} false.</li>
     *   <li><b>STALE</b> — a submission exists but predates the {@link #freshnessWindow}.</li>
     *   <li><b>SUBMITTED</b> — a submission exists and is within the window.</li>
     * </ul>
     *
     * <p>Freshness boundary: a submission dated exactly {@code now - freshnessWindow} counts as
     * SUBMITTED, not STALE — the check is {@code submittedAt.isBefore(cutoff)}, so only strictly
     * older submissions lapse. Chosen so the window is inclusive of its own edge; the integration
     * test pins this at the boundary.
     */
    private WorkerReadiness classify(UUID workerId, String displayName,
            Optional<ReadinessSubmission> latest, Instant now) {

        if (latest.isEmpty()) {
            return new WorkerReadiness(workerId, displayName, ReadinessStatus.MISSING, null, null, false);
        }

        ReadinessSubmission submission = latest.get();
        Instant cutoff = now.minus(freshnessWindow);
        ReadinessStatus status = submission.getSubmittedAt().isBefore(cutoff)
                ? ReadinessStatus.STALE
                : ReadinessStatus.SUBMITTED;

        return new WorkerReadiness(workerId, displayName, status,
                submission.isFitToWork(), submission.getSubmittedAt(), hasFlaggedSymptom(submission));
    }

    /** True when the submission carries any symptom other than NONE. */
    private static boolean hasFlaggedSymptom(ReadinessSubmission submission) {
        return submission.getSymptoms().stream().anyMatch(symptom -> symptom != SymptomFlag.NONE);
    }
}
