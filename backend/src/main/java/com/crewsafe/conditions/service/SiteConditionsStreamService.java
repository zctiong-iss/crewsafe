package com.crewsafe.conditions.service;

import com.crewsafe.conditions.api.ConditionsSnapshot;
import com.crewsafe.conditions.config.ConditionsStreamProperties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.ScheduledFuture;

/**
 * Turns repeated {@link ConditionsSnapshotService#getSnapshot} calls into a per-site SSE
 * push stream: one scheduled task per subscriber, cancelled the moment its emitter
 * completes, times out, or errors, so a client that walks away doesn't leave it ticking.
 *
 * @author Jemilin Beulah
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class SiteConditionsStreamService {

    private static final String EVENT_NAME = "conditions";

    private final ConditionsSnapshotService snapshotService;
    private final TaskScheduler scheduler;
    private final ConditionsStreamProperties properties;

    public SseEmitter subscribe(UUID siteId) {
        SseEmitter emitter = new SseEmitter(properties.getEmitterTimeout().toMillis());

        ScheduledFuture<?> future = scheduler.scheduleAtFixedRate(
                () -> pushSnapshot(siteId, emitter), Instant.now(), properties.getPushInterval());

        Runnable cancel = () -> future.cancel(false);
        emitter.onCompletion(cancel);
        emitter.onTimeout(cancel);
        emitter.onError(throwable -> cancel.run());

        return emitter;
    }

    private void pushSnapshot(UUID siteId, SseEmitter emitter) {
        try {
            ConditionsSnapshot snapshot = snapshotService.getSnapshot(siteId);
            emitter.send(SseEmitter.event().name(EVENT_NAME).data(snapshot, MediaType.APPLICATION_JSON));
        } catch (Exception exception) {
            // A closed tab surfaces here as an IOException from send() — routine, not a failure.
            log.debug("Ending conditions stream for site {}: {}", siteId, exception.toString());
            emitter.completeWithError(exception);
        }
    }
}
