package com.crewsafe.operation.service;

import com.crewsafe.operation.api.AlertCountResponse;
import com.crewsafe.operation.domain.ActionDispatch;
import com.crewsafe.operation.repository.ActionDispatchRepository;
import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.domain.ShiftStatus;
import com.crewsafe.shift.repository.ShiftRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

/**
 * Covers how a site resolves to its action-status stream payload (SCRUM-317/324): via the
 * site's ACTIVE shift, the same lookup {@code ConditionsSnapshotService} already uses, not
 * a direct siteId join. No active shift is "nothing to show", not an error.
 *
 * @author Jemilin Beulah
 */
@ExtendWith(MockitoExtension.class)
class ActionStatusSnapshotServiceTest {

    private static final Instant NOW = Instant.parse("2026-08-13T09:00:00Z");
    private static final UUID SITE_ID = UUID.randomUUID();

    @Mock
    private ActionDispatchRepository actionDispatchRepository;

    @Mock
    private ShiftRepository shiftRepository;

    private ActionStatusSnapshotService service;

    @BeforeEach
    void setUp() {
        service = new ActionStatusSnapshotService(actionDispatchRepository, shiftRepository,
                Clock.fixed(NOW, ZoneOffset.UTC));
    }

    @Test
    void dispatchesForSiteIsEmptyWhenNoActiveShift() {
        when(shiftRepository.findFirstBySiteIdAndStatusOrderByStartsAtDesc(SITE_ID, ShiftStatus.ACTIVE))
                .thenReturn(Optional.empty());

        assertThat(service.getDispatchesForSite(SITE_ID)).isEmpty();
    }

    @Test
    void dispatchesForSiteResolvesThroughTheActiveShift() {
        Shift shift = new Shift(SITE_ID, Instant.parse("2026-08-13T08:00:00Z"), Instant.parse("2026-08-13T16:00:00Z"));
        ActionDispatch dispatch = dispatchWithStatus(ActionDispatch.ActionDispatchStatus.PENDING);
        when(shiftRepository.findFirstBySiteIdAndStatusOrderByStartsAtDesc(SITE_ID, ShiftStatus.ACTIVE))
                .thenReturn(Optional.of(shift));
        when(actionDispatchRepository.findByShiftId(shift.getId())).thenReturn(List.of(dispatch));

        assertThat(service.getDispatchesForSite(SITE_ID)).containsExactly(dispatch);
    }

    @Test
    void alertCountTalliesEachStatusFromTheGivenList() {
        List<ActionDispatch> dispatches = List.of(
                dispatchWithStatus(ActionDispatch.ActionDispatchStatus.PENDING),
                dispatchWithStatus(ActionDispatch.ActionDispatchStatus.PENDING),
                dispatchWithStatus(ActionDispatch.ActionDispatchStatus.LATE),
                dispatchWithStatus(ActionDispatch.ActionDispatchStatus.ACKNOWLEDGED),
                dispatchWithStatus(ActionDispatch.ActionDispatchStatus.COMPLETED));

        AlertCountResponse alertCount = service.toAlertCount(SITE_ID, dispatches);

        assertThat(alertCount).isEqualTo(new AlertCountResponse(SITE_ID, 2, 1, 1, 1, NOW));
    }

    @Test
    void alertCountIsAllZeroForAnEmptyList() {
        AlertCountResponse alertCount = service.toAlertCount(SITE_ID, List.of());

        assertThat(alertCount).isEqualTo(new AlertCountResponse(SITE_ID, 0, 0, 0, 0, NOW));
    }

    private static ActionDispatch dispatchWithStatus(ActionDispatch.ActionDispatchStatus status) {
        return ActionDispatch.builder()
                .id(UUID.randomUUID())
                .actionCode("REST_10_MIN")
                .status(status)
                .dispatchedAt(NOW)
                .build();
    }
}
