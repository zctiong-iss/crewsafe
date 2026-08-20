package com.crewsafe.shift.summary;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import com.crewsafe.audit.AuditQueryService;
import com.crewsafe.common.error.ResourceNotFoundException;
import com.crewsafe.identity.security.CrewSafeUserPrincipal;
import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.service.ShiftService;

import lombok.RequiredArgsConstructor;

/**
 * The SCRUM-139 (US-44) shift close-out summary: an audit-reconciled record of one shift, plus the
 * same record as a downloadable CSV. Lives under the shift path because it is the shift's record.
 *
 * <h2>Why a SUPERVISOR reads this but not the raw audit trail</h2>
 *
 * The site audit timeline ({@link com.crewsafe.audit.AuditController}) is {@code SAFETY_MANAGER}/
 * {@code ADMIN} only: it records what supervisors did, so a supervisor reading it is the wrong side
 * of the accountability line. This summary is different in kind — aggregate counts of the
 * supervisor's <em>own</em> shift ("a record I can defend", US-44), not the cross-actor row-level
 * trail. So it carries the same three-role gate the shift's own {@code POST …/close} does, and a
 * supervisor gets totals for their site's shifts without the manager-only timeline being widened.
 *
 * <p>Site-scoped, not owner-scoped: a member supervisor reads any shift at their site, exactly as
 * they already list, edit, cancel and close any shift there — shifts belong to a site, not to the
 * supervisor who planned them.
 *
 * @author Tang Chee Seng
 */
@RestController
@RequestMapping("/api/v1/sites/{siteId}/shifts/{shiftId}/summary")
@RequiredArgsConstructor
public class ShiftSummaryController {

    private static final String SUMMARY_ROLES =
            "hasAnyRole('SUPERVISOR', 'SAFETY_MANAGER', 'ADMIN') and @siteAccess.canAccess(#siteId)";

    private final ShiftCloseSummaryService summaries;
    private final ShiftService shifts;
    private final AuditQueryService audit;

    @GetMapping
    @PreAuthorize(SUMMARY_ROLES)
    public ResponseEntity<ShiftCloseSummaryResponse> summary(@PathVariable UUID siteId, @PathVariable UUID shiftId) {
        return ResponseEntity.ok(summaries.summarise(siteId, shiftId)
                .orElseThrow(() -> noSuchShift(siteId, shiftId)));
    }

    @GetMapping("/export.csv")
    @PreAuthorize(SUMMARY_ROLES)
    public ResponseEntity<StreamingResponseBody> export(@PathVariable UUID siteId, @PathVariable UUID shiftId,
            @AuthenticationPrincipal CrewSafeUserPrincipal principal) {

        // Resolved before the stream opens: once the StreamingResponseBody starts, the headers
        // (including the 404 status a missing shift needs) have already been flushed.
        Shift shift = shifts.getShift(siteId, shiftId).orElseThrow(() -> noSuchShift(siteId, shiftId));
        String localRange = shifts.localRange(siteId, shift.getStartsAt(), shift.getEndsAt());

        StreamingResponseBody body =
                out -> audit.writeShiftCsv(out, siteId, shiftId, principal.getId(), localRange);

        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"" + audit.shiftFilenameFor(shiftId) + "\"")
                // text/csv, explicit UTF-8 — the detail column carries worker-entered free text.
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .body(body);
    }

    private static ResourceNotFoundException noSuchShift(UUID siteId, UUID shiftId) {
        return new ResourceNotFoundException("No shift " + shiftId + " under site " + siteId);
    }
}
