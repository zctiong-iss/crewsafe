package com.crewsafe.operation.service;

import com.crewsafe.operation.api.ActionDispatchResponse;
import com.crewsafe.operation.api.AlertCountResponse;
import com.crewsafe.operation.config.ActionDispatchStreamProperties;
import com.crewsafe.operation.domain.ActionDispatch;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ScheduledFuture;

/**
 * Turns repeated {@link ActionStatusSnapshotService} calls into a per-site SSE push
 * stream, same shape as {@code SiteConditionsStreamService} (SCRUM-168): one scheduled
 * task per subscriber, cancelled the moment its emitter completes, times out, or errors.
 *
 * <p>Shares {@code conditionsTaskScheduler} rather than declaring a second {@link
 * TaskScheduler} bean -- Spring can't disambiguate two same-typed beans against a plain
 * {@code TaskScheduler scheduler} field, which is how {@code SiteConditionsStreamService}
 * already injects it, so a second bean would break that existing wiring.
 *
 * <p>Each tick sends one {@code action-status} event per dispatch in the site's active
 * shift, then one {@code alert-count} event summarizing them (SCRUM-317) -- so a client
 * never has to sum events itself to get the badge number.
 *
 * @author Jemilin Beulah
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ActionStatusStreamService {

    private static final String ACTION_STATUS_EVENT = "action-status";
    private static final String ALERT_COUNT_EVENT = "alert-count";

    private final ActionStatusSnapshotService snapshotService;
    private final TaskScheduler scheduler;
    private final ActionDispatchStreamProperties properties;

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
            List<ActionDispatch> dispatches = snapshotService.getDispatchesForSite(siteId);
            for (ActionDispatch dispatch : dispatches) {
                emitter.send(SseEmitter.event().name(ACTION_STATUS_EVENT)
                        .data(ActionDispatchResponse.fromEntity(dispatch), MediaType.APPLICATION_JSON));
            }

            AlertCountResponse alertCount = snapshotService.toAlertCount(siteId, dispatches);
            emitter.send(SseEmitter.event().name(ALERT_COUNT_EVENT).data(alertCount, MediaType.APPLICATION_JSON));
        } catch (Exception exception) {
            // A closed tab surfaces here as an IOException from send() -- routine, not a failure.
            log.debug("action_status_stream_ended");
            emitter.completeWithError(exception);
        }
    }
}
