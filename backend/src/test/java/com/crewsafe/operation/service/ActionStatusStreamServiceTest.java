package com.crewsafe.operation.service;

import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.operation.api.AlertCountResponse;
import com.crewsafe.operation.config.ActionDispatchStreamProperties;
import com.crewsafe.operation.domain.ActionDispatch;
import com.crewsafe.operation.domain.Approval;
import com.crewsafe.operation.domain.Recommendation;
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
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Covers the scheduled push and its cancellation wiring, same split as {@code
 * SiteConditionsStreamServiceTest} (SCRUM-168): who can open the stream is
 * ActionStatusStreamAuthorizationTest's job, not this class's.
 *
 * @author Jemilin Beulah
 */
@ExtendWith(MockitoExtension.class)
class ActionStatusStreamServiceTest {

    private static final UUID SITE_ID = UUID.randomUUID();

    @Mock
    private ActionStatusSnapshotService snapshotService;

    @Mock
    private TaskScheduler scheduler;

    @Mock
    private ActionDispatchStreamProperties properties;

    @SuppressWarnings({"unchecked", "rawtypes"})
    @Mock
    private ScheduledFuture scheduledTask;

    private ActionStatusStreamService service;

    @BeforeEach
    void setUp() {
        service = new ActionStatusStreamService(snapshotService, scheduler, properties);
        when(properties.getEmitterTimeout()).thenReturn(Duration.ofMinutes(5));
        when(properties.getPushInterval()).thenReturn(Duration.ofSeconds(10));
    }

    private static ActionDispatch dispatch(ActionDispatch.ActionDispatchStatus status) {
        Recommendation recommendation = Recommendation.builder().id(UUID.randomUUID()).build();
        Approval approval = Approval.builder()
                .id(UUID.randomUUID())
                .recommendation(recommendation)
                .build();
        AppUser worker = AppUser.builder().id(UUID.randomUUID()).role(Role.WORKER).build();

        return ActionDispatch.builder()
                .id(UUID.randomUUID())
                .recommendation(recommendation)
                .approval(approval)
                .worker(worker)
                .actionCode("REST_10_MIN")
                .status(status)
                .dispatchedAt(Instant.now())
                .build();
    }

    @Test
    void pushesAnActionStatusEventPerDispatchThenOneAlertCountEvent() throws Exception {
        ArgumentCaptor<Runnable> task = ArgumentCaptor.forClass(Runnable.class);
        when(scheduler.scheduleAtFixedRate(task.capture(), any(Instant.class), any(Duration.class)))
                .thenReturn(scheduledTask);
        List<ActionDispatch> dispatches = List.of(
                dispatch(ActionDispatch.ActionDispatchStatus.PENDING),
                dispatch(ActionDispatch.ActionDispatchStatus.LATE));
        when(snapshotService.getDispatchesForSite(SITE_ID)).thenReturn(dispatches);
        when(snapshotService.toAlertCount(SITE_ID, dispatches))
                .thenReturn(new AlertCountResponse(SITE_ID, 1, 1, 0, 0, Instant.now()));

        try (MockedConstruction<SseEmitter> construction = mockConstruction(SseEmitter.class)) {
            SseEmitter emitter = service.subscribe(SITE_ID);

            task.getValue().run();

            verify(emitter, times(3)).send(any(SseEmitter.SseEventBuilder.class));
        }
    }

    @Test
    void completesWithErrorInsteadOfPropagatingWhenSendFails() throws Exception {
        ArgumentCaptor<Runnable> task = ArgumentCaptor.forClass(Runnable.class);
        when(scheduler.scheduleAtFixedRate(task.capture(), any(Instant.class), any(Duration.class)))
                .thenReturn(scheduledTask);
        when(snapshotService.getDispatchesForSite(SITE_ID))
                .thenReturn(List.of(dispatch(ActionDispatch.ActionDispatchStatus.PENDING)));

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
