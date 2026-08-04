package com.crewsafe.conditions.api;

import com.crewsafe.conditions.service.SiteConditionsStreamService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.UUID;

/**
 * Pushes {@link ConditionsSnapshot} events for a site as they change. Same authorization
 * shape as {@link com.crewsafe.site.api.SiteController#getDashboard} — reuses
 * {@code @siteAccess} rather than a new mechanism.
 */
@RestController
@RequestMapping("/api/v1/sites/{siteId}/conditions")
@RequiredArgsConstructor
public class SiteConditionsController {

    private final SiteConditionsStreamService streamService;

    @GetMapping(path = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    @PreAuthorize("hasAnyRole('SUPERVISOR', 'SAFETY_MANAGER', 'ADMIN') and @siteAccess.canAccess(#siteId)")
    public SseEmitter stream(@PathVariable UUID siteId) {
        return streamService.subscribe(siteId);
    }
}
