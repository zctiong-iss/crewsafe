package com.crewsafe.shift.summary;

import com.crewsafe.common.audit.AuditEventType;
import com.crewsafe.shift.summary.ShiftCloseSummaryResponse.Actions;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The SCRUM-139 type→bucket mapping in isolation — a pure unit test, no Spring, because the mapping
 * is where a countable total could quietly land in the wrong column. AC2/AC3 of the spec.
 *
 * @author Tang Chee Seng
 */
class ShiftActionsBucketTest {

    @Test
    void eachEventTypeLandsInTheRightBucket() {
        Map<String, Long> counts = new HashMap<>();
        counts.put(AuditEventType.ACTION_DISPATCHED, 2L);
        counts.put(AuditEventType.ACTION_AUTO_DISPATCHED, 1L);   // issued counts both dispatch paths
        counts.put(AuditEventType.ACTION_ACKNOWLEDGED, 3L);
        counts.put(AuditEventType.ACTION_COMPLETED, 1L);
        counts.put(AuditEventType.ACTION_AUTO_COMPLETED, 2L);    // completed counts the sweep too
        counts.put(AuditEventType.ACTION_LATE, 1L);
        counts.put(AuditEventType.CONCERN_RAISED, 1L);           // exceptions = late + concern

        Actions actions = Actions.from(counts);

        assertThat(actions.issued()).isEqualTo(3);
        assertThat(actions.acknowledged()).isEqualTo(3);
        assertThat(actions.completed()).isEqualTo(3);
        assertThat(actions.exceptions()).isEqualTo(2);
    }

    @Test
    void unrelatedEventTypesNeverLeakIntoAnActionBucket() {
        Map<String, Long> counts = new HashMap<>();
        counts.put(AuditEventType.SHIFT_CREATED, 5L);
        counts.put(AuditEventType.SHIFT_CLOSED, 1L);
        counts.put(AuditEventType.READINESS_SUBMITTED, 4L);   // conditions, not an action
        counts.put(AuditEventType.SHIFT_ASSIGNMENT_ADDED, 3L);

        Actions actions = Actions.from(counts);

        assertThat(actions).isEqualTo(new Actions(0, 0, 0, 0));
    }

    @Test
    void anAutoCompleteIsCompletedNotAnException() {
        Map<String, Long> counts = Map.of(AuditEventType.ACTION_AUTO_COMPLETED, 1L);

        Actions actions = Actions.from(counts);

        assertThat(actions.completed()).isEqualTo(1);
        assertThat(actions.exceptions()).isZero();
    }

    @Test
    void emptyCountsYieldAllZeroBuckets() {
        assertThat(Actions.from(Map.of())).isEqualTo(new Actions(0, 0, 0, 0));
    }

    @Test
    void theBucketsNeverDoubleCountAcrossColumns() {
        // Every action-source type set to 1; the four buckets must sum to exactly those seven types,
        // so no type is counted in two columns and none is dropped.
        Map<String, Long> counts = new HashMap<>();
        for (String type : new String[]{
                AuditEventType.ACTION_DISPATCHED, AuditEventType.ACTION_AUTO_DISPATCHED,
                AuditEventType.ACTION_ACKNOWLEDGED, AuditEventType.ACTION_COMPLETED,
                AuditEventType.ACTION_AUTO_COMPLETED, AuditEventType.ACTION_LATE,
                AuditEventType.CONCERN_RAISED}) {
            counts.put(type, 1L);
        }

        Actions actions = Actions.from(counts);
        int bucketed = actions.issued() + actions.acknowledged() + actions.completed() + actions.exceptions();

        assertThat(bucketed).isEqualTo(7);
    }
}
