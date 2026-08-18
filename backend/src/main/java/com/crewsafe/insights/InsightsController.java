package com.crewsafe.insights;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.UUID;

/**
 * The SCRUM-433 insights surface for a site: compliance and response-time analytics over a window.
 *
 * <p>A supervisor and a safety manager both read it — a supervisor to see how their own site is
 * responding, a manager for oversight — so it carries the same role set and {@code @siteAccess}
 * scope as the other supervisor surfaces. New controller rather than an addition to
 * {@code SiteController}, which is left as its stub.
 *
 * @author Tang Chee Seng
 */
@RestController
@RequestMapping("/api/v1/sites/{siteId}/insights")
@RequiredArgsConstructor
public class InsightsController {

    private final ComplianceService compliance;

    @GetMapping("/compliance")
    @PreAuthorize("hasAnyRole('SUPERVISOR', 'SAFETY_MANAGER', 'ADMIN') and @siteAccess.canAccess(#siteId)")
    public ResponseEntity<ComplianceReport> compliance(
            @PathVariable UUID siteId,
            @RequestParam Instant from,
            @RequestParam Instant to) {

        return ResponseEntity.ok(compliance.report(siteId, from, to));
    }
}
