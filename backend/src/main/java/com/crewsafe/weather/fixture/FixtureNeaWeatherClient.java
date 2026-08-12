package com.crewsafe.weather.fixture;

import com.crewsafe.weather.nea.NeaMetric;
import com.crewsafe.weather.nea.NeaObservation;
import com.crewsafe.weather.nea.NeaStation;
import com.crewsafe.weather.nea.NeaStationReading;
import com.crewsafe.weather.nea.NeaWeatherClient;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.io.Resource;
import org.springframework.core.io.ResourceLoader;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Arrays;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Offline, deterministic NEA replacement for demonstrations and repeatable tests.
 *
 * <p>One call to {@link #fetchAll()} advances exactly one frame. With looping disabled,
 * replay holds the final frame so a long-running demo remains deterministic and duplicate
 * ingestion exercises the same database protection as live mode.
 *
 * @author Bryan Phang
 */
@Component
@ConditionalOnProperty(prefix = "app.weather.data", name = "mode", havingValue = "fixture")
@Slf4j
public class FixtureNeaWeatherClient implements NeaWeatherClient {

    private final List<Map<NeaMetric, NeaObservation>> frames;
    private final boolean loop;
    private int currentFrame;

    public FixtureNeaWeatherClient(ObjectMapper objectMapper, ResourceLoader resourceLoader,
                                   WeatherFixtureProperties properties) {
        this.frames = loadFrames(objectMapper, resourceLoader.getResource(properties.getResource()));
        this.loop = properties.isLoop();
    }

    /** Returns the current frame without moving the replay cursor. */
    @Override
    public synchronized NeaObservation fetch(NeaMetric metric) {
        if (metric == null) {
            throw new IllegalArgumentException("metric is required");
        }
        return frames.get(currentFrame).get(metric);
    }

    /** Returns one coherent frame for all metrics, then advances the replay cursor once. */
    @Override
    public synchronized List<NeaObservation> fetchAll() {
        Map<NeaMetric, NeaObservation> frame = frames.get(currentFrame);
        List<NeaObservation> result = Arrays.stream(NeaMetric.values())
                .map(frame::get)
                .toList();
        if (loop) {
            currentFrame = (currentFrame + 1) % frames.size();
        } else if (currentFrame < frames.size() - 1) {
            currentFrame++;
        }
        return result;
    }

    private List<Map<NeaMetric, NeaObservation>> loadFrames(ObjectMapper objectMapper,
                                                             Resource resource) {
        try (InputStream input = resource.getInputStream()) {
            FixtureDocument document = objectMapper.readValue(input, FixtureDocument.class);
            List<Map<NeaMetric, NeaObservation>> loadedFrames = validateAndMap(document);

            // capturedAt and description describe the replay scenario itself. Individual
            // frame timestamps remain the observation times stored by weather ingestion.
            log.info("weather_fixture_loaded frames={}", loadedFrames.size());
            return loadedFrames;
        } catch (IOException exception) {
            throw new IllegalStateException("Weather fixture could not be loaded", exception);
        }
    }

    private List<Map<NeaMetric, NeaObservation>> validateAndMap(FixtureDocument document) {
        if (document == null || document.capturedAt() == null
                || !StringUtils.hasText(document.description())
                || document.frames() == null || document.frames().isEmpty()) {
            throw invalid("fixture requires capturedAt, description, and at least one frame");
        }

        Map<String, NeaStation> stations = mapStations(document.stations());
        return document.frames().stream()
                .map(frame -> mapFrame(frame, stations))
                .toList();
    }

    private Map<String, NeaStation> mapStations(List<FixtureStation> fixtureStations) {
        if (fixtureStations == null || fixtureStations.isEmpty()) {
            throw invalid("fixture requires at least one station");
        }

        Map<String, NeaStation> stations = new LinkedHashMap<>();
        for (FixtureStation station : fixtureStations) {
            if (station == null || !StringUtils.hasText(station.id())
                    || !StringUtils.hasText(station.name())
                    || station.latitude() == null || station.longitude() == null) {
                throw invalid("fixture contains incomplete station metadata");
            }
            if (stations.put(station.id(), new NeaStation(station.id(), station.name(),
                    station.latitude(), station.longitude())) != null) {
                throw invalid("fixture contains duplicate station " + station.id());
            }
        }
        return stations;
    }

    private Map<NeaMetric, NeaObservation> mapFrame(FixtureFrame frame,
                                                     Map<String, NeaStation> stations) {
        if (frame == null || frame.observedAt() == null
                || frame.observations() == null || frame.observations().isEmpty()) {
            throw invalid("fixture contains an incomplete frame");
        }

        Map<NeaMetric, NeaObservation> observations = new EnumMap<>(NeaMetric.class);
        for (FixtureObservation observation : frame.observations()) {
            NeaObservation mapped = mapObservation(frame.observedAt(), observation, stations);
            if (observations.put(mapped.metric(), mapped) != null) {
                throw invalid("fixture frame contains duplicate metric " + mapped.metric());
            }
        }
        for (NeaMetric metric : NeaMetric.values()) {
            if (!observations.containsKey(metric)) {
                throw invalid("fixture frame is missing metric " + metric);
            }
        }
        return Map.copyOf(observations);
    }

    private NeaObservation mapObservation(Instant observedAt, FixtureObservation observation,
                                          Map<String, NeaStation> stations) {
        if (observation == null || observation.metric() == null
                || !StringUtils.hasText(observation.unit())
                || observation.readings() == null || observation.readings().isEmpty()) {
            throw invalid("fixture contains an incomplete observation");
        }

        List<NeaStationReading> readings = observation.readings().stream()
                .map(reading -> mapReading(observation.metric(), reading, stations))
                .toList();
        return new NeaObservation(observation.metric(), observedAt, observation.unit(), readings, true);
    }

    private NeaStationReading mapReading(NeaMetric metric, FixtureReading reading,
                                         Map<String, NeaStation> stations) {
        if (reading == null || !StringUtils.hasText(reading.stationId()) || reading.value() == null) {
            throw invalid("fixture contains an incomplete station reading");
        }
        NeaStation station = stations.get(reading.stationId());
        if (station == null) {
            throw invalid("fixture reading references unknown station " + reading.stationId());
        }
        if (metric == NeaMetric.WBGT && !StringUtils.hasText(reading.heatStress())) {
            throw invalid("fixture WBGT reading requires a heatStress label");
        }
        return new NeaStationReading(station, reading.value(), reading.heatStress());
    }

    private IllegalStateException invalid(String message) {
        return new IllegalStateException("Invalid weather fixture: " + message);
    }

    private record FixtureDocument(Instant capturedAt, String description,
                                   List<FixtureStation> stations, List<FixtureFrame> frames) {
    }

    private record FixtureStation(String id, String name, BigDecimal latitude,
                                  BigDecimal longitude) {
    }

    private record FixtureFrame(Instant observedAt, List<FixtureObservation> observations) {
    }

    private record FixtureObservation(NeaMetric metric, String unit,
                                      List<FixtureReading> readings) {
    }

    private record FixtureReading(String stationId, BigDecimal value, String heatStress) {
    }
}
