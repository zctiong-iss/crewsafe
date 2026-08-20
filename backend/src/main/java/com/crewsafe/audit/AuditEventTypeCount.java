package com.crewsafe.audit;

/**
 * One {@code (event_type, count)} row of the SCRUM-139 shift-scoped aggregation — a Spring Data
 * interface projection whose getters match the native query's column aliases, so no DTO or mapper
 * stands between the {@code GROUP BY} and the caller.
 *
 * @author Tang Chee Seng
 */
public interface AuditEventTypeCount {

    String getEventType();

    long getTotal();
}
