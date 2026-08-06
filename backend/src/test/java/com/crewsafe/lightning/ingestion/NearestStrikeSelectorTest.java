package com.crewsafe.lightning.ingestion;

import com.crewsafe.lightning.nea.NeaLightningStrike;
import com.crewsafe.site.domain.Site;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

/** @author Jemilin Beulah */
class NearestStrikeSelectorTest {

    private final NearestStrikeSelector selector = new NearestStrikeSelector();

    @Test
    void selectsTheGeographicallyNearestStrikeRatherThanListOrder() {
        Site site = new Site("Central Site", decimal("1.3000"), decimal("103.8000"));
        NeaLightningStrike far = strike("1.4300", "103.9600");
        NeaLightningStrike near = strike("1.3010", "103.8010");

        Optional<NearestStrikeSelector.Selection> selected = selector.select(site, List.of(far, near));

        assertThat(selected).isPresent();
        assertThat(selected.get().strike()).isEqualTo(near);
        assertThat(selected.get().distanceKm()).isLessThan(decimal("2.0"));
    }

    @Test
    void noStrikesIsAValidEmptyResultNotAnError() {
        Site site = new Site("Quiet Site", decimal("1.3000"), decimal("103.8000"));

        assertThat(selector.select(site, List.of())).isEmpty();
    }

    private NeaLightningStrike strike(String latitude, String longitude) {
        return new NeaLightningStrike(decimal(latitude), decimal(longitude), Instant.now(), "C");
    }

    private BigDecimal decimal(String value) {
        return new BigDecimal(value);
    }
}
