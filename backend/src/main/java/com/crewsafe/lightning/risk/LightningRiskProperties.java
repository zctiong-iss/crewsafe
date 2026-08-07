package com.crewsafe.lightning.risk;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.time.Duration;

/**
 * Distance bands and auto-expiry window for lightning stop-work derivation (SCRUM-170).
 *
 * <p>Neither the exact km thresholds nor the expiry model are specified by SCRUM-170, its
 * Jira parent, or the project plan's §7.1 — which says only "hold until a
 * supervisor-confirmed all-clear (typically 30 minutes after the last nearby strike)".
 * Product direction for this pass: auto-expire on a fixed validity window rather than
 * require a manual confirmation action, using 10km / 20km as the stop-work / advisory
 * radii (the common "30-30 rule" convention) and 30 minutes as the window, matching the
 * plan's "typically" figure. All three are configuration, not constants, so they can be
 * retuned without a redeploy once a real policy is confirmed.
 *
 * @author Jemilin Beulah
 */
@ConfigurationProperties(prefix = "app.lightning.risk")
@Validated
@Getter
@Setter
public class LightningRiskProperties {

    @NotNull
    @Positive
    private Double stopWorkRadiusKm;

    @NotNull
    @Positive
    private Double advisoryRadiusKm;

    @NotNull
    private Duration validityWindow;

    @AssertTrue(message = "lightning advisory radius must exceed the stop-work radius")
    public boolean isRadiusConfigurationValid() {
        return stopWorkRadiusKm != null && advisoryRadiusKm != null
                && advisoryRadiusKm > stopWorkRadiusKm;
    }
}
