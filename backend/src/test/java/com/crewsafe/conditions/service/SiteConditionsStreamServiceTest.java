package com.crewsafe.conditions.service;

import com.crewsafe.conditions.api.ConditionsSnapshot;
import com.crewsafe.conditions.config.ConditionsStreamProperties;
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
import java.util.UUID;
import java.util.concurrent.ScheduledFuture;
import java.util.function.Consumer;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mockConstruction;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Covers the scheduled push and its cancellation wiring -- the part {@link
 * SiteConditionsAuthorizationTest} deliberately doesn't touch (it verifies who can open the
 * stream, not what runs on it). {@link SseEmitter} is constructed inside {@code subscribe},
 * so {@link MockedConstruction} is what lets a test get a handle on it.
 *
 * @author Jemilin Beulah
 */
@ExtendWith(MockitoExtension.class)
class SiteConditionsStreamServiceTest {

    private static final UUID SITE_ID = UUID.randomUUID();

    @Mock
    private ConditionsSnapshotService snapshotService;

    @Mock
    private TaskScheduler scheduler;

    @Mock
    private ConditionsStreamProperties properties;

    // Raw type deliberately: ScheduledFuture<?>'s wildcard can't be satisfied by any single
    // concrete mock type, and the production code only ever calls cancel() on it anyway.
    @SuppressWarnings({"unchecked", "rawtypes"})
    @Mock
    private ScheduledFuture scheduledTask;

    private SiteConditionsStreamService service;

    @BeforeEach
    void setUp() {
        service = new SiteConditionsStreamService(snapshotService, scheduler, properties);
        when(properties.getEmitterTimeout()).thenReturn(Duration.ofMinutes(5));
        when(properties.getPushInterval()).thenReturn(Duration.ofSeconds(15));
    }

    @Test
    void pushesASnapshotEventOnEachScheduledTick() throws Exception {
        ArgumentCaptor<Runnable> task = ArgumentCaptor.forClass(Runnable.class);
        when(scheduler.scheduleAtFixedRate(task.capture(), any(Instant.class), any(Duration.class)))
                .thenReturn(scheduledTask);
        when(snapshotService.getSnapshot(SITE_ID))
                .thenReturn(new ConditionsSnapshot(SITE_ID, null, null, null, Instant.now()));

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
        when(snapshotService.getSnapshot(SITE_ID))
                .thenReturn(new ConditionsSnapshot(SITE_ID, null, null, null, Instant.now()));

        try (MockedConstruction<SseEmitter> construction = mockConstruction(SseEmitter.class,
                (mock, context) -> doThrow(new IOException("client disconnected"))
                        .when(mock).send(any(SseEmitter.SseEventBuilder.class)))) {
            SseEmitter emitter = service.subscribe(SITE_ID);

            task.getValue().run();

            verify(emitter).completeWithError(any(IOException.class));
        }
    }

    @Test
    void cancelsTheScheduledTaskWhenTheEmitterCompletes() {
        when(scheduler.scheduleAtFixedRate(any(Runnable.class), any(Instant.class), any(Duration.class)))
                .thenReturn(scheduledTask);

        try (MockedConstruction<SseEmitter> construction = mockConstruction(SseEmitter.class)) {
            SseEmitter emitter = service.subscribe(SITE_ID);

            ArgumentCaptor<Runnable> onCompletion = ArgumentCaptor.forClass(Runnable.class);
            verify(emitter).onCompletion(onCompletion.capture());
            onCompletion.getValue().run();

            verify(scheduledTask).cancel(false);
        }
    }

    @Test
    @SuppressWarnings("unchecked")
    void cancelsTheScheduledTaskWhenTheEmitterErrors() {
        when(scheduler.scheduleAtFixedRate(any(Runnable.class), any(Instant.class), any(Duration.class)))
                .thenReturn(scheduledTask);

        try (MockedConstruction<SseEmitter> construction = mockConstruction(SseEmitter.class)) {
            SseEmitter emitter = service.subscribe(SITE_ID);

            ArgumentCaptor<Consumer<Throwable>> onError = ArgumentCaptor.forClass(Consumer.class);
            verify(emitter).onError(onError.capture());
            onError.getValue().accept(new RuntimeException("boom"));

            verify(scheduledTask).cancel(false);
        }
    }
}
