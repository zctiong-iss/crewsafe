package com.crewsafe.audit;

import com.crewsafe.common.audit.AuditEventType;

import java.util.Map;

/**
 * Human-readable labels for the raw {@link AuditEventType} constants, for the SCRUM-435
 * inspector timeline. The export ships both: the label an inspector reads and the raw constant
 * they can filter or quote exactly.
 *
 * <p>An unknown type (an event written by a feature newer than this map) falls back to the raw
 * constant rather than throwing — a missing label must never hide a real audit row.
 *
 * @author Tang Chee Seng
 */
public final class AuditEventLabels {

    private static final Map<String, String> LABELS = Map.ofEntries(
            Map.entry(AuditEventType.TOKEN_FIRST_SEEN, "Session token first seen"),
            Map.entry(AuditEventType.ACCESS_DENIED, "Access denied"),
            Map.entry(AuditEventType.SHIFT_CREATED, "Shift created"),
            Map.entry(AuditEventType.SHIFT_UPDATED, "Shift times corrected"),
            Map.entry(AuditEventType.SHIFT_DELETED, "Shift deleted"),
            Map.entry(AuditEventType.SHIFT_CANCELLED, "Shift cancelled"),
            Map.entry(AuditEventType.SHIFT_ACTIVATED, "Shift activated"),
            Map.entry(AuditEventType.SHIFT_ASSIGNMENT_UPDATED, "Assignment corrected"),
            Map.entry(AuditEventType.SHIFT_ASSIGNMENT_REMOVED, "Worker removed from shift"),
            Map.entry(AuditEventType.READINESS_SUBMITTED, "Readiness submitted"),
            Map.entry(AuditEventType.ACTION_DISPATCHED, "Action dispatched"),
            Map.entry(AuditEventType.ACTION_ACKNOWLEDGED, "Action acknowledged"),
            Map.entry(AuditEventType.ACTION_COMPLETED, "Action completed"),
            Map.entry(AuditEventType.ACTION_LATE, "Action went late"),
            Map.entry(AuditEventType.ACTION_AUTO_COMPLETED, "Action auto-completed"),
            Map.entry(AuditEventType.RECOMMENDATION_DRAFTED, "Recommendation drafted"),
            Map.entry(AuditEventType.RECOMMENDATION_APPROVED, "Recommendation approved"),
            Map.entry(AuditEventType.RECOMMENDATION_REJECTED, "Recommendation rejected"),
            Map.entry(AuditEventType.RECOMMENDATION_EDITED, "Recommendation approved with edits"),
            Map.entry(AuditEventType.RECOMMENDATION_SUPERSEDED, "Recommendation superseded"),
            Map.entry(AuditEventType.RECOMMENDATION_AUTO_DISPATCHED, "Stop-work auto-dispatched"),
            Map.entry(AuditEventType.ACTION_AUTO_DISPATCHED, "Action auto-dispatched"),
            Map.entry(AuditEventType.WELLBEING_LOGGED, "Wellbeing logged"),
            Map.entry(AuditEventType.CONCERN_RAISED, "Concern raised"),
            Map.entry(AuditEventType.CONCERN_ACKNOWLEDGED, "Concern acknowledged"),
            Map.entry(AuditEventType.POLICY_VERSION_CREATED, "Heat policy version created"),
            Map.entry(AuditEventType.POLICY_VERSION_ACTIVATED, "Heat policy version activated"));

    private AuditEventLabels() {
    }

    /** The human label for a raw event type, or the raw type itself when none is mapped. */
    public static String labelFor(String eventType) {
        return LABELS.getOrDefault(eventType, eventType);
    }
}
