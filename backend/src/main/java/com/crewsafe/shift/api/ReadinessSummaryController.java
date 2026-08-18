package com.crewsafe.shift.api;

import com.crewsafe.shift.service.ReadinessSummaryService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * The SCRUM-437 supervisor readiness summary: how much of each upcoming shift's roster has
 * cleared the pre-shift readiness check, for one site.
 *
 * <p>Same gate as every other supervisor surface — a {@code SUPERVISOR} runs their own site,
 * {@code SAFETY_MANAGER}/{@code ADMIN} read across for oversight — and {@code @siteAccess}
 * scopes it to sites the caller actually belongs to, so a site id from elsewhere reads as 403.
 *
 * @author Tang Chee Seng
 */
@RestController
@RequestMapping("/api/v1/sites/{siteId}")
@RequiredArgsConstructor
public class ReadinessSummaryController {

    private final ReadinessSummaryService readiness;

    @GetMapping("/readiness-summary")
    @PreAuthorize("hasAnyRole('SUPERVISOR', 'SAFETY_MANAGER', 'ADMIN') and @siteAccess.canAccess(#siteId)")
    public ResponseEntity<ReadinessSummaryResponse> summary(@PathVariable UUID siteId) {
        return ResponseEntity.ok(readiness.summarise(siteId));
    }
}
