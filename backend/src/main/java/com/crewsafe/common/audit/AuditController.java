package com.crewsafe.common.audit;

import com.crewsafe.common.error.BadRequestException;
import com.crewsafe.identity.security.CrewSafeUserPrincipal;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

/**
 * Audit timeline export (SCRUM-452, US-15), implementing {@code docs/api/audit.yaml}.
 *
 * <p>Role-gated to SAFETY_MANAGER/ADMIN rather than the usual
 * SUPERVISOR/SAFETY_MANAGER/ADMIN group the other write endpoints use. This is the one
 * endpoint that reads the entire trail out of the system in bulk — including rows about
 * other people's actions — and the web app already declares the same narrower group for
 * its {@code /audit} route ({@code web/src/app/routeAccess.ts}).
 *
 * <p>Still site-scoped via {@code @siteAccess.canAccess(#siteId)} like every other
 * endpoint; see {@link AuditEventRepository#findForSiteBetween} for how a row without a
 * {@code site_id} column is attributed to a site.
 *
 * @author Abu Bakar
 */
@RestController
@RequestMapping("/api/v1/sites/{siteId}/audit")
@RequiredArgsConstructor
public class AuditController {

    private final AuditExportService auditExportService;
    private final Clock clock;

    /** Names the digest the file also carries, so a client can check it without parsing. */
    static final String CHECKSUM_HEADER = "X-Content-SHA256";

    @GetMapping(value = "/export", produces = "text/csv")
    @PreAuthorize("hasAnyRole('SAFETY_MANAGER', 'ADMIN') and @siteAccess.canAccess(#siteId)")
    public ResponseEntity<byte[]> exportAuditTimeline(
            @PathVariable UUID siteId,
            @AuthenticationPrincipal CrewSafeUserPrincipal principal,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to) {

        // Both ends default to "everything so far" rather than to a rolling window: an
        // inspector asking for the record wants the record, and a silent default of, say,
        // the last 30 days would hand them a partial history that looks complete.
        Instant rangeFrom = from == null ? Instant.EPOCH : from;
        Instant rangeTo = to == null ? clock.instant() : to;

        if (!rangeTo.isAfter(rangeFrom)) {
            throw new BadRequestException("'to' must be after 'from'");
        }

        AuditExportService.AuditExport export =
                auditExportService.export(siteId, principal.getId(), rangeFrom, rangeTo);

        return ResponseEntity.ok()
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment()
                        .filename(export.filename())
                        .build()
                        .toString())
                .header(CHECKSUM_HEADER, export.sha256())
                .body(export.body().getBytes(StandardCharsets.UTF_8));
    }
}
