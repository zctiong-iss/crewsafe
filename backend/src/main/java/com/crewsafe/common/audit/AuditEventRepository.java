package com.crewsafe.common.audit;

import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * @author Jemilin Beulah
 * @author Abu Bakar
 */
public interface AuditEventRepository extends Repository<AuditEvent, UUID> {

    <S extends AuditEvent> S save(S event);

    List<AuditEvent> findByEventTypeOrderByOccurredAtDesc(String eventType);

    /**
     * Every audit row belonging to one site, oldest first, for the inspector export
     * (SCRUM-452).
     *
     * <p>{@code audit_event} has no {@code site_id} column, so each row's site is resolved
     * here by joining out through {@code target_type}/{@code target_id}. Denormalising a
     * {@code site_id} onto the table instead would mean a migration with a backfill plus a
     * change to all 21 audit write call sites; resolving at read time keeps the write paths
     * untouched and is reversible if that trade later stops paying.
     *
     * <p>Almost every target type funnels through {@code shift_id -> shift.site_id}. The two
     * exceptions are {@code SITE}, whose {@code target_id} <em>is</em> the site (this is how
     * {@code ACCESS_DENIED} is recorded), and {@code POLICY_VERSION}, which carries its own
     * {@code site_id}.
     *
     * <p>A row whose site resolves to NULL is excluded, because {@code NULL = :siteId} is
     * never true. That is deliberate and load-bearing: it drops {@code USER}-targeted rows
     * ({@code TOKEN_FIRST_SEEN} is a login, not site evidence) and the company-wide default
     * {@code policy_version} row, whose {@code site_id} is NULL by design since V18. Neither
     * belongs to a site, and emitting them into one site's export is exactly the cross-site
     * bleed this scoping exists to prevent.
     *
     * <p>Ordered oldest-first: this is read as a timeline, not as a feed. {@code id} breaks
     * ties so an export of the same range is byte-identical run to run, which the SHA-256 in
     * the exported file's own preamble depends on.
     */
    @Query(nativeQuery = true, value = """
            SELECT ae.*
            FROM audit_event ae
            LEFT JOIN shift               sh    ON ae.target_type = 'SHIFT'                AND sh.id    = ae.target_id
            LEFT JOIN shift_assignment    sa    ON ae.target_type = 'SHIFT_ASSIGNMENT'     AND sa.id    = ae.target_id
            LEFT JOIN shift               sash  ON sash.id  = sa.shift_id
            LEFT JOIN recommendation      rc    ON ae.target_type = 'RECOMMENDATION'       AND rc.id    = ae.target_id
            LEFT JOIN shift               rcsh  ON rcsh.id  = rc.shift_id
            LEFT JOIN action_dispatch     ad    ON ae.target_type = 'ACTION_DISPATCH'      AND ad.id    = ae.target_id
            LEFT JOIN recommendation      adrc  ON adrc.id  = ad.recommendation_id
            LEFT JOIN shift               adsh  ON adsh.id  = adrc.shift_id
            LEFT JOIN readiness_submission rs   ON ae.target_type = 'READINESS_SUBMISSION' AND rs.id    = ae.target_id
            LEFT JOIN shift               rssh  ON rssh.id  = rs.shift_id
            LEFT JOIN wellbeing_log       wl    ON ae.target_type = 'WELLBEING_LOG'        AND wl.id    = ae.target_id
            LEFT JOIN shift               wlsh  ON wlsh.id  = wl.shift_id
            LEFT JOIN concern             cn    ON ae.target_type = 'CONCERN'              AND cn.id    = ae.target_id
            LEFT JOIN shift               cnsh  ON cnsh.id  = cn.shift_id
            LEFT JOIN policy_version      pv    ON ae.target_type = 'POLICY_VERSION'       AND pv.id    = ae.target_id
            WHERE COALESCE(
                      CASE WHEN ae.target_type = 'SITE' THEN ae.target_id END,
                      sh.site_id, sash.site_id, rcsh.site_id, adsh.site_id,
                      rssh.site_id, wlsh.site_id, cnsh.site_id, pv.site_id
                  ) = :siteId
              AND ae.occurred_at >= :from
              AND ae.occurred_at < :to
            ORDER BY ae.occurred_at, ae.id
            """)
    List<AuditEvent> findForSiteBetween(@Param("siteId") UUID siteId,
                                        @Param("from") Instant from,
                                        @Param("to") Instant to);
}
