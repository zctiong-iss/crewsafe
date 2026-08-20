package com.crewsafe.wellbeing.service;

import com.crewsafe.wellbeing.config.WellbeingStreamProperties;
import com.crewsafe.wellbeing.domain.Concern;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.MockedConstruction;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ScheduledFuture;
import java.util.function.Consumer;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mockConstruction;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Scheduled snapshot and cleanup behaviour for the US-11 concern stream. */
@ExtendWith(MockitoExtension.class)
class ConcernStreamServiceTest {

    private static final UUID SITE_ID = UUID.randomUUID();

    @Mock private WellbeingService wellbeing;
    @Mock private TaskScheduler scheduler;
    @Mock private WellbeingStreamProperties properties;

    @SuppressWarnings({"unchecked", "rawtypes"})
    @Mock
    private ScheduledFuture scheduledTask;

    private ConcernStreamService service;

    @BeforeEach
    void setUp() {
        service = new ConcernStreamService(wellbeing, scheduler, properties);
        when(properties.getEmitterTimeout()).thenReturn(Duration.ofMinutes(5));
        when(properties.getPushInterval()).thenReturn(Duration.ofSeconds(10));
    }

    @Test
    void pushesOneCompleteConcernSnapshotPerTick() throws Exception {
        ArgumentCaptor<Runnable> task = ArgumentCaptor.forClass(Runnable.class);
        when(scheduler.scheduleAtFixedRate(task.capture(), any(Instant.class), any(Duration.class)))
                .thenReturn(scheduledTask);
        Concern concern = Concern.raise(UUID.randomUUID(), UUID.randomUUID(), java.util.Set.of(),
                "Feeling faint", Instant.now());
        when(wellbeing.openConcernsForSite(SITE_ID)).thenReturn(List.of(concern));

        try (MockedConstruction<SseEmitter> construction = mockConstruction(SseEmitter.class)) {
            SseEmitter emitter = service.subscribe(SITE_ID);

            task.getValue().run();

            verify(wellbeing).openConcernsForSite(SITE_ID);
            verify(emitter).send(any(SseEmitter.SseEventBuilder.class));
        }
    }

    @Test
    void anEmptyOpenListStillPushesAClearingSnapshot() throws Exception {
        ArgumentCaptor<Runnable> task = ArgumentCaptor.forClass(Runnable.class);
        when(scheduler.scheduleAtFixedRate(task.capture(), any(Instant.class), any(Duration.class)))
                .thenReturn(scheduledTask);
        when(wellbeing.openConcernsForSite(SITE_ID)).thenReturn(List.of());

        try (MockedConstruction<SseEmitter> construction = mockConstruction(SseEmitter.class)) {
            SseEmitter emitter = service.subscribe(SITE_ID);

            task.getValue().run();

            verify(emitter).send(any(SseEmitter.SseEventBuilder.class));
        }
    }

    @Test
    void completesWithErrorInsteadOfPropagatingWhenSendFails() throws Exception {
        ArgumentCaptor<Runnable> task = ArgumentCaptor.forClass(Runnable.class);
        when(scheduler.scheduleAtFixedRate(task.capture(), any(Instant.class), any(Duration.class)))
                .thenReturn(scheduledTask);
        when(wellbeing.openConcernsForSite(SITE_ID)).thenReturn(List.of());

        try (MockedConstruction<SseEmitter> construction = mockConstruction(SseEmitter.class,
                (mock, context) -> doThrow(new IOException("client disconnected"))
                        .when(mock).send(any(SseEmitter.SseEventBuilder.class)))) {
            SseEmitter emitter = service.subscribe(SITE_ID);

            task.getValue().run();

            verify(emitter).completeWithError(any(IOException.class));
        }
    }

    @Test
    void cancelsTheScheduledTaskWhenTheEmitterCompletesTimesOutOrErrors() {
        when(scheduler.scheduleAtFixedRate(any(Runnable.class), any(Instant.class), any(Duration.class)))
                .thenReturn(scheduledTask);

        try (MockedConstruction<SseEmitter> construction = mockConstruction(SseEmitter.class)) {
            SseEmitter emitter = service.subscribe(SITE_ID);

            ArgumentCaptor<Runnable> onCompletion = ArgumentCaptor.forClass(Runnable.class);
            ArgumentCaptor<Runnable> onTimeout = ArgumentCaptor.forClass(Runnable.class);
            @SuppressWarnings("unchecked")
            ArgumentCaptor<Consumer<Throwable>> onError = ArgumentCaptor.forClass(Consumer.class);
            verify(emitter).onCompletion(onCompletion.capture());
            verify(emitter).onTimeout(onTimeout.capture());
            verify(emitter).onError(onError.capture());

            onCompletion.getValue().run();
            onTimeout.getValue().run();
            onError.getValue().accept(new RuntimeException("boom"));

            verify(scheduledTask, org.mockito.Mockito.times(3)).cancel(false);
        }
    }
}
