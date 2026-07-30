package com.crewsafe.weather.ingestion;

import com.crewsafe.site.domain.Site;
import com.crewsafe.weather.nea.NeaStation;
import com.crewsafe.weather.nea.NeaStationReading;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class NearestStationSelectorTest {

    private final NearestStationSelector selector = new NearestStationSelector();

    @Test
    void selectsTheGeographicallyNearestReadingRatherThanListOrder() {
        Site site = new Site("Central Site", decimal("1.3000"), decimal("103.8000"));
        NeaStationReading far = reading("FAR", "1.4300", "103.9600");
        NeaStationReading near = reading("NEAR", "1.3010", "103.8010");

        NeaStationReading selected = selector.select(site, List.of(far, near));

        assertThat(selected.station().id()).isEqualTo("NEAR");
    }

    private NeaStationReading reading(String id, String latitude, String longitude) {
        return new NeaStationReading(
                new NeaStation(id, id + " station", decimal(latitude), decimal(longitude)),
                decimal("30.0"), null);
    }

    private BigDecimal decimal(String value) {
        return new BigDecimal(value);
    }
}
