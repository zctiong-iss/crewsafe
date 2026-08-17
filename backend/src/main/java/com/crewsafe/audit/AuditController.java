package com.crewsafe.audit;

import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import java.time.Instant;
import java.util.UUID;

/**
 * The SCRUM-435 audit trail for a site: a paged timeline for the web view, and the same slice
 * as a downloadable CSV for an inspector.
 *
 * <p>Gated harder than the supervisor surfaces — {@code SAFETY_MANAGER}/{@code ADMIN} only, not
 * {@code SUPERVISOR}. The audit trail is oversight-of-oversight: it records what supervisors did,
 * so a supervisor reading their own trail is the wrong side of the accountability line. Still
 * {@code @siteAccess}-scoped, so a manager only reads sites they are a member of.
 *
 * @author Tang Chee Seng
 */
@RestController
@RequestMapping("/api/v1/sites/{siteId}/audit")
@RequiredArgsConstructor
public class AuditController {

    private static final String MANAGER_ON_SITE =
            "hasAnyRole('SAFETY_MANAGER', 'ADMIN') and @siteAccess.canAccess(#siteId)";

    private final AuditQueryService audit;

    @GetMapping
    @PreAuthorize(MANAGER_ON_SITE)
    public ResponseEntity<AuditPageResponse> page(
            @PathVariable UUID siteId,
            @RequestParam Instant from,
            @RequestParam Instant to,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int pageSize) {

        return ResponseEntity.ok(audit.page(siteId, from, to, page, pageSize));
    }

    @GetMapping("/export.csv")
    @PreAuthorize(MANAGER_ON_SITE)
    public ResponseEntity<StreamingResponseBody> export(
            @PathVariable UUID siteId,
            @RequestParam Instant from,
            @RequestParam Instant to) {

        StreamingResponseBody body = out -> audit.writeCsv(out, siteId, from, to);
        String filename = audit.filenameFor(siteId, to);

        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                // text/csv with an explicit UTF-8 charset — the detail column carries worker-entered
                // free text, which is not guaranteed ASCII.
                .contentType(new MediaType("text", "csv", java.nio.charset.StandardCharsets.UTF_8))
                .body(body);
    }
}
