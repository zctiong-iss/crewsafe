package com.crewsafe.operation.api;

import com.crewsafe.operation.service.ActionStatusStreamService;
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
 * Pushes {@code action-status} and {@code alert-count} events for a site's active shift as
 * dispatches change (SCRUM-317/324). Same authorization shape as {@link
 * com.crewsafe.conditions.api.SiteConditionsController#stream} -- reuses {@code
 * @siteAccess} rather than a new mechanism.
 *
 * @author Jemilin Beulah
 */
@RestController
@RequestMapping("/api/v1/sites/{siteId}/actions")
@RequiredArgsConstructor
public class ActionStatusStreamController {

    private final ActionStatusStreamService streamService;

    @GetMapping(path = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    @PreAuthorize("hasAnyRole('SUPERVISOR', 'SAFETY_MANAGER', 'ADMIN') and @siteAccess.canAccess(#siteId)")
    public SseEmitter stream(@PathVariable UUID siteId) {
        return streamService.subscribe(siteId);
    }
}
