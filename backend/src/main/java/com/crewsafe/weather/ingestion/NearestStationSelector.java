package com.crewsafe.weather.ingestion;

import com.crewsafe.site.domain.Site;
import com.crewsafe.weather.nea.NeaStation;
import com.crewsafe.weather.nea.NeaStationReading;
import org.springframework.stereotype.Component;

import java.util.Comparator;
import java.util.List;

/** Chooses the geographically nearest available station reading for a site. */
@Component
public class NearestStationSelector {

    private static final double EARTH_RADIUS_KM = 6_371.0088;

    public NeaStationReading select(Site site, List<NeaStationReading> readings) {
        if (site == null || readings == null || readings.isEmpty()) {
            throw new IllegalArgumentException("site and at least one station reading are required");
        }

        double siteLatitude = site.getLatitude().doubleValue();
        double siteLongitude = site.getLongitude().doubleValue();
        return readings.stream()
                .filter(reading -> reading != null && reading.station() != null)
                .min(Comparator.comparingDouble(reading -> distanceKm(
                        siteLatitude, siteLongitude, reading.station())))
                .orElseThrow(() -> new IllegalArgumentException("no valid station reading is available"));
    }

    private double distanceKm(double siteLatitude, double siteLongitude, NeaStation station) {
        double lat1 = Math.toRadians(siteLatitude);
        double lat2 = Math.toRadians(station.latitude().doubleValue());
        double deltaLatitude = lat2 - lat1;
        double deltaLongitude = Math.toRadians(station.longitude().doubleValue() - siteLongitude);

        double haversine = Math.pow(Math.sin(deltaLatitude / 2), 2)
                + Math.cos(lat1) * Math.cos(lat2) * Math.pow(Math.sin(deltaLongitude / 2), 2);
        return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(haversine));
    }
}
