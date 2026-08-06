package com.crewsafe.lightning.ingestion;

import com.crewsafe.lightning.nea.NeaLightningStrike;
import com.crewsafe.site.domain.Site;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

/**
 * Chooses the geographically nearest strike to a site, if any were reported this tick.
 * Unlike {@code NearestStationSelector}, an empty reading list is a valid "no strikes"
 * result rather than an error — NEA's per-metric weather feeds always carry at least one
 * station reading, but a lightning batch legitimately reports zero strikes most of the time.
 *
 * @author Jemilin Beulah
 */
@Component
public class NearestStrikeSelector {

    private static final double EARTH_RADIUS_KM = 6_371.0088;

    public Optional<Selection> select(Site site, List<NeaLightningStrike> strikes) {
        if (site == null) {
            throw new IllegalArgumentException("site is required");
        }
        if (strikes == null || strikes.isEmpty()) {
            return Optional.empty();
        }

        double siteLatitude = site.getLatitude().doubleValue();
        double siteLongitude = site.getLongitude().doubleValue();
        return strikes.stream()
                .filter(strike -> strike != null && strike.latitude() != null && strike.longitude() != null)
                .min(Comparator.comparingDouble(
                        strike -> distanceKm(siteLatitude, siteLongitude, strike)))
                .map(strike -> new Selection(strike, toDistance(
                        distanceKm(siteLatitude, siteLongitude, strike))));
    }

    private double distanceKm(double siteLatitude, double siteLongitude, NeaLightningStrike strike) {
        double lat1 = Math.toRadians(siteLatitude);
        double lat2 = Math.toRadians(strike.latitude().doubleValue());
        double deltaLatitude = lat2 - lat1;
        double deltaLongitude = Math.toRadians(strike.longitude().doubleValue() - siteLongitude);

        double haversine = Math.pow(Math.sin(deltaLatitude / 2), 2)
                + Math.cos(lat1) * Math.cos(lat2) * Math.pow(Math.sin(deltaLongitude / 2), 2);
        return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(haversine));
    }

    private BigDecimal toDistance(double distanceKm) {
        return BigDecimal.valueOf(distanceKm).setScale(2, RoundingMode.HALF_UP);
    }

    public record Selection(NeaLightningStrike strike, BigDecimal distanceKm) {
    }
}
