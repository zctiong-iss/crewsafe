package com.crewsafe.wellbeing.service;

import com.crewsafe.wellbeing.api.WorkerWellbeingController.ConcernResponse;
import com.crewsafe.wellbeing.config.WellbeingStreamProperties;
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

/** Publishes complete open-concern snapshots for one site. */
@Service
@RequiredArgsConstructor
@Slf4j
public class ConcernStreamService {

    private static final String CONCERNS_EVENT = "concerns";

    private final WellbeingService wellbeing;
    private final TaskScheduler scheduler;
    private final WellbeingStreamProperties properties;

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
            List<ConcernResponse> snapshot = wellbeing.openConcernsForSite(siteId).stream()
                    .map(ConcernResponse::from)
                    .toList();
            emitter.send(SseEmitter.event().name(CONCERNS_EVENT)
                    .data(snapshot, MediaType.APPLICATION_JSON));
        } catch (Exception exception) {
            log.debug("concern_stream_ended");
            emitter.completeWithError(exception);
        }
    }
}
