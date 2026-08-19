package com.crewsafe.shift.service;

import com.crewsafe.common.audit.AuditEventType;
import com.crewsafe.common.audit.AuditService;
import com.crewsafe.common.error.BadRequestException;
import com.crewsafe.shift.domain.ReadinessSubmission;
import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.domain.ShiftAssignment;
import com.crewsafe.shift.domain.SymptomFlag;
import com.crewsafe.shift.repository.ReadinessSubmissionRepository;
import com.crewsafe.shift.repository.ShiftAssignmentRepository;
import com.crewsafe.shift.repository.ShiftRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/** Worker-only shift view and append-only readiness submissions (SCRUM-163). */
@Service
@RequiredArgsConstructor
public class WorkerShiftService {

    private static final PageRequest FIRST_RESULT = PageRequest.of(0, 1);

    private final ShiftRepository shifts;
    private final ShiftAssignmentRepository assignments;
    private final ReadinessSubmissionRepository readinessSubmissions;
    private final AuditService audit;

    public record WorkerShift(Shift shift, ShiftAssignment assignment,
                              ReadinessSubmission latestReadiness) {
    }

    /**
     * Returns a shift happening now, or the soonest future shift when none is current.
     * Every query is scoped to the authenticated worker's local user id.
     */
    @Transactional(readOnly = true)
    public Optional<WorkerShift> findCurrentOrNext(UUID workerId) {
        Instant now = Instant.now();
        Optional<Shift> selectedShift = first(shifts.findCurrentForWorker(workerId, now, FIRST_RESULT))
                .or(() -> first(shifts.findUpcomingForWorker(workerId, now, FIRST_RESULT)));

        return selectedShift.map(shift -> {
            ShiftAssignment assignment = assignments.findByShiftIdAndWorkerId(shift.getId(), workerId)
                    .orElseThrow(() -> new IllegalStateException(
                            "Worker shift query returned a shift without its assignment"));
            ReadinessSubmission latest = readinessSubmissions
                    .findFirstByShiftIdAndWorkerIdOrderBySubmittedAtDescIdDesc(shift.getId(), workerId)
                    .orElse(null);
            return new WorkerShift(shift, assignment, latest);
        });
    }

    /**
     * Appends a readiness answer. Empty means the shift does not exist (404); an existing
     * shift without this worker's assignment is deliberately the same 403 for every worker.
     */
    @Transactional
    public Optional<ReadinessSubmission> submitReadiness(UUID workerId, UUID shiftId,
            boolean fitToWork, boolean adequateSleep, boolean adequateHydration,
            List<SymptomFlag> symptomFlags) {
        validateSymptoms(symptomFlags);

        if (!shifts.existsById(shiftId)) {
            return Optional.empty();
        }
        if (assignments.findByShiftIdAndWorkerId(shiftId, workerId).isEmpty()) {
            throw new AccessDeniedException("Only the assigned worker may submit readiness");
        }

        ReadinessSubmission submission = readinessSubmissions.save(new ReadinessSubmission(
                shiftId, workerId, fitToWork, adequateSleep, adequateHydration,
                Set.copyOf(symptomFlags)));

        afterCommit(() -> audit.recordEvent(workerId, AuditEventType.READINESS_SUBMITTED,
                "READINESS_SUBMISSION", submission.getId(),
                "Submitted readiness for shift " + shiftId));
        return Optional.of(submission);
    }

    private void validateSymptoms(List<SymptomFlag> symptomFlags) {
        if (symptomFlags == null || symptomFlags.isEmpty()) {
            throw new BadRequestException("symptoms must contain at least one flag");
        }
        if (new HashSet<>(symptomFlags).size() != symptomFlags.size()) {
            throw new BadRequestException("symptoms must not contain duplicate flags");
        }
        if (symptomFlags.contains(SymptomFlag.NONE) && symptomFlags.size() > 1) {
            throw new BadRequestException("NONE cannot be combined with another symptom");
        }
    }

    private Optional<Shift> first(List<Shift> matches) {
        return matches.stream().findFirst();
    }

    /** Audit is written only after the readiness transaction has committed successfully. */
    private void afterCommit(Runnable action) {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                action.run();
            }
        });
    }
}
