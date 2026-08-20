package com.crewsafe.audit;

import com.crewsafe.common.audit.AuditEvent;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * The read side of the audit trail for the SCRUM-435 inspector export. Separate from the
 * write-side {@link com.crewsafe.common.audit.AuditService}: nothing here can create or mutate
 * an audit row (the table is append-only at the DB level anyway), it only assembles a
 * site-scoped, actor-named timeline.
 *
 * <h2>Why the scoping is a native COALESCE and not a column</h2>
 * {@code audit_event} deliberately has no {@code site_id} — an event names its target as a
 * {@code (target_type, target_id)} pair, and different target types reach a site by different
 * routes. This query resolves an <em>effective</em> site per row:
 * <ul>
 *   <li>{@code SHIFT} → the shift's site.</li>
 *   <li>{@code RECOMMENDATION} / {@code ACTION_DISPATCH} → recommendation → shift → site
 *       (a dispatch reaches its recommendation via {@code recommendation_id}).</li>
 *   <li>{@code READINESS_SUBMISSION} / {@code WELLBEING_LOG} / {@code CONCERN} → the row's own
 *       {@code shift_id} → shift → site.</li>
 *   <li>{@code POLICY_VERSION} → the version's site directly.</li>
 *   <li>{@code SITE} → the target <em>is</em> the site.</li>
 * </ul>
 * A {@code USER}-scoped event (e.g. {@code TOKEN_FIRST_SEEN}) resolves to no site and so is
 * excluded from every site's export — which is correct: a token-first-seen is an identity
 * event, not a site operation. Adding a new site-bound target type means adding a join arm
 * here; that coupling is the price of not denormalising a {@code site_id} onto an append-only
 * table (which would need a backfill and a write-path change across every teammate's module).
 *
 * @author Tang Chee Seng
 */
public interface AuditExportRepository extends JpaRepository<AuditEvent, UUID> {

    /**
     * The FROM + all joins that resolve an <em>effective shift</em> (and, through it, an effective
     * site) for every audit row, whatever its target type. Extracted so the site-scoped timeline
     * and the SCRUM-139 shift-scoped close-out summary read a row's shift the same way — a second
     * copy of this {@code COALESCE} join is exactly the thing that drifts. Adding a WHERE turns it
     * into a site scope or a shift scope; the joins themselves are identical either way.
     */
    String EFFECTIVE_SHIFT_JOINS = """
            FROM audit_event ae
            LEFT JOIN app_user actor ON actor.id = ae.actor_id
            LEFT JOIN action_dispatch ad ON ae.target_type = 'ACTION_DISPATCH' AND ad.id = ae.target_id
            LEFT JOIN recommendation rec ON rec.id = COALESCE(
                CASE WHEN ae.target_type = 'RECOMMENDATION' THEN ae.target_id END,
                ad.recommendation_id)
            LEFT JOIN readiness_submission rs ON ae.target_type = 'READINESS_SUBMISSION' AND rs.id = ae.target_id
            LEFT JOIN wellbeing_log wl ON ae.target_type = 'WELLBEING_LOG' AND wl.id = ae.target_id
            LEFT JOIN concern c ON ae.target_type = 'CONCERN' AND c.id = ae.target_id
            LEFT JOIN policy_version pv ON ae.target_type = 'POLICY_VERSION' AND pv.id = ae.target_id
            LEFT JOIN shift sh ON sh.id = COALESCE(
                CASE WHEN ae.target_type = 'SHIFT' THEN ae.target_id END,
                rec.shift_id, rs.shift_id, wl.shift_id, c.shift_id)
            """;

    /** The shared FROM + effective-site resolution + time-window filter, reused verbatim by the
     *  page query, its count, and the export query so all three scope identically. */
    String SITE_SCOPED_FROM = EFFECTIVE_SHIFT_JOINS + """
            WHERE ae.occurred_at >= :from AND ae.occurred_at < :to
              AND :siteId = COALESCE(
                    sh.site_id,
                    pv.site_id,
                    CASE WHEN ae.target_type = 'SITE' THEN ae.target_id END)
            """;

    /**
     * The same joins, scoped to a single shift (SCRUM-139). A row belongs to a shift when the
     * effective-shift resolution above lands on that {@code sh.id} — which naturally excludes the
     * {@code SITE}- and {@code POLICY_VERSION}-scoped rows that resolve to no shift, so a shift's
     * record carries only the events about that shift. Not time-windowed, unlike the site scope:
     * the close-out record is every event ever recorded about the shift, not a chosen window.
     */
    String SHIFT_SCOPED_FROM = EFFECTIVE_SHIFT_JOINS + " WHERE sh.id = :shiftId ";

    String SELECT_COLUMNS = """
            SELECT ae.occurred_at   AS occurredAt,
                   ae.actor_id      AS actorId,
                   actor.display_name AS actorName,
                   ae.event_type    AS eventType,
                   ae.target_type   AS targetType,
                   ae.target_id     AS targetId,
                   ae.correlation_id AS correlationId,
                   ae.detail        AS detail
            """;

    /** One page of the timeline, newest first. {@code id DESC} is a deterministic tiebreaker for
     *  same-instant events, so paging never drops or repeats a row across page boundaries. */
    @Query(value = SELECT_COLUMNS + SITE_SCOPED_FROM
            + " ORDER BY ae.occurred_at DESC, ae.id DESC",
            countQuery = "SELECT COUNT(*) " + SITE_SCOPED_FROM,
            nativeQuery = true)
    Page<AuditRowView> findSitePage(@Param("siteId") UUID siteId,
            @Param("from") Instant from, @Param("to") Instant to, Pageable pageable);

    /** The whole slice for the CSV export — unpaged, because an export is complete by definition. */
    @Query(value = SELECT_COLUMNS + SITE_SCOPED_FROM
            + " ORDER BY ae.occurred_at DESC, ae.id DESC",
            nativeQuery = true)
    List<AuditRowView> findSiteSlice(@Param("siteId") UUID siteId,
            @Param("from") Instant from, @Param("to") Instant to);

    /**
     * Per-event-type counts for one shift (SCRUM-139). The close-out summary derives its totals
     * from this, so a number on screen is a {@code COUNT(*)} of the very rows the audit trail
     * holds for the shift — the summary reconciles with the trail by construction, not by a
     * separate tally kept in step by hand.
     */
    @Query(value = "SELECT ae.event_type AS eventType, COUNT(*) AS total "
            + SHIFT_SCOPED_FROM + " GROUP BY ae.event_type",
            nativeQuery = true)
    List<AuditEventTypeCount> countByEventTypeForShift(@Param("shiftId") UUID shiftId);

    /** The shift's whole effective-event slice, newest first — the rows the shift-scoped CSV
     *  export writes. Same row shape as {@link #findSiteSlice}, so a shift export reads identically
     *  to a site export, only narrower. */
    @Query(value = SELECT_COLUMNS + SHIFT_SCOPED_FROM
            + " ORDER BY ae.occurred_at DESC, ae.id DESC",
            nativeQuery = true)
    List<AuditRowView> findShiftSlice(@Param("shiftId") UUID shiftId);
}
