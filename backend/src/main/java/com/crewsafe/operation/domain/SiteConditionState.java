package com.crewsafe.operation.domain;

import com.crewsafe.lightning.domain.LightningRiskState;
import com.crewsafe.weather.domain.WbgtBand;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * A site's WBGT band and lightning risk state as of the auto-trigger scheduler's last
 * evaluation (SCRUM-291) -- recompute-on-read gives the current value everywhere else in the
 * codebase, but detecting a <em>transition</em> needs the previous value too, and nothing
 * upstream persists one. One row per site, upserted on every evaluation tick regardless of
 * whether it fired a draft, so the next tick always compares against what this one saw.
 *
 * <p>Both fields are nullable and a null is a real, comparable value here, not "unknown" --
 * a site with no weather or no lightning history yet has no band/state at all, and a first
 * reading arriving is itself a transition worth catching.
 *
 * @author Abu Bakar
 */
@Entity
@Table(name = "site_condition_state")
@Getter
@Setter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class SiteConditionState {

    @Id
    @Column(name = "site_id")
    private UUID siteId;

    @Enumerated(EnumType.STRING)
    @Column(name = "last_wbgt_band")
    private WbgtBand lastWbgtBand;

    @Enumerated(EnumType.STRING)
    @Column(name = "last_lightning_state")
    private LightningRiskState lastLightningState;

    @Column(name = "last_evaluated_at", nullable = false)
    private Instant lastEvaluatedAt;

    public SiteConditionState(UUID siteId, WbgtBand lastWbgtBand, LightningRiskState lastLightningState,
                               Instant lastEvaluatedAt) {
        this.siteId = siteId;
        this.lastWbgtBand = lastWbgtBand;
        this.lastLightningState = lastLightningState;
        this.lastEvaluatedAt = lastEvaluatedAt;
    }
}
