package com.crewsafe.lightning.fixture;

import com.crewsafe.lightning.nea.NeaLightningClient;
import com.crewsafe.lightning.nea.NeaLightningObservation;
import com.crewsafe.lightning.nea.NeaLightningStrike;
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
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;

/**
 * Offline, deterministic lightning replacement for demonstrations and repeatable tests, one
 * frame per {@link #fetchLatest()} call — mirrors {@code FixtureNeaWeatherClient}'s replay
 * cursor semantics, with one deliberate difference: WBGT's fixture keeps its absolute JSON
 * timestamps as-is because {@code SIMULATED} readings skip the freshness recompute entirely.
 * Lightning can't do the same — {@code LightningRiskDerivationService} decides stop-work vs.
 * clear by comparing a strike's own timestamp against the real clock, not just its freshness
 * label. A fixture dated "2026-07-30" replayed on some later real date would fall outside
 * that lookback window on the very first tick and never show anything but CLEAR. So each
 * strike is re-anchored to "now" at fetch time, keeping only its authored offset before the
 * tick that reported it (a few seconds to a couple of minutes, per the JSON) — the story the
 * fixture tells stays intact, but it always plays out as if it just started happening.
 *
 * @author Jemilin Beulah
 */
@Component
@ConditionalOnProperty(prefix = "app.weather.data", name = "mode", havingValue = "fixture")
@Slf4j
public class FixtureNeaLightningClient implements NeaLightningClient {

    private final List<FrameTemplate> frames;
    private final boolean loop;
    private final Clock clock;
    private int currentFrame;

    public FixtureNeaLightningClient(ObjectMapper objectMapper, ResourceLoader resourceLoader,
                                     LightningFixtureProperties properties, Clock clock) {
        this.frames = loadFrames(objectMapper, resourceLoader.getResource(properties.getResource()));
        this.loop = properties.isLoop();
        this.clock = clock;
    }

    @Override
    public synchronized NeaLightningObservation fetchLatest() {
        FrameTemplate template = frames.get(currentFrame);
        if (loop) {
            currentFrame = (currentFrame + 1) % frames.size();
        } else if (currentFrame < frames.size() - 1) {
            currentFrame++;
        }
        return template.resolveAgainst(clock.instant());
    }

    private List<FrameTemplate> loadFrames(ObjectMapper objectMapper, Resource resource) {
        try (InputStream input = resource.getInputStream()) {
            FixtureDocument document = objectMapper.readValue(input, FixtureDocument.class);
            List<FrameTemplate> loadedFrames = validateAndMap(document);

            log.info("lightning_fixture_loaded frames={}", loadedFrames.size());
            return loadedFrames;
        } catch (IOException exception) {
            throw new IllegalStateException("Lightning fixture could not be loaded", exception);
        }
    }

    private List<FrameTemplate> validateAndMap(FixtureDocument document) {
        if (document == null || document.capturedAt() == null
                || !StringUtils.hasText(document.description())
                || document.frames() == null || document.frames().isEmpty()) {
            throw invalid("fixture requires capturedAt, description, and at least one frame");
        }
        return document.frames().stream().map(this::mapFrame).toList();
    }

    private FrameTemplate mapFrame(FixtureFrame frame) {
        if (frame == null || frame.observedAt() == null || frame.strikes() == null) {
            throw invalid("fixture contains an incomplete frame");
        }
        List<StrikeTemplate> strikes = frame.strikes().stream()
                .map(strike -> mapStrike(strike, frame.observedAt()))
                .toList();
        return new FrameTemplate(strikes);
    }

    private StrikeTemplate mapStrike(FixtureStrike strike, Instant frameObservedAt) {
        if (strike == null || strike.latitude() == null || strike.longitude() == null
                || strike.struckAt() == null || !StringUtils.hasText(strike.type())) {
            throw invalid("fixture contains an incomplete strike reading");
        }
        Duration offsetBeforeTick = Duration.between(strike.struckAt(), frameObservedAt);
        if (offsetBeforeTick.isNegative()) {
            throw invalid("fixture strike is timestamped after its own frame's observedAt");
        }
        return new StrikeTemplate(strike.latitude(), strike.longitude(), offsetBeforeTick, strike.type());
    }

    private IllegalStateException invalid(String message) {
        return new IllegalStateException("Invalid lightning fixture: " + message);
    }

    private record FixtureDocument(Instant capturedAt, String description, List<FixtureFrame> frames) {
    }

    private record FixtureFrame(Instant observedAt, List<FixtureStrike> strikes) {
    }

    private record FixtureStrike(BigDecimal latitude, BigDecimal longitude, Instant struckAt,
                                 String type) {
    }

    /** A strike's authored position in the story: where, what kind, and how long before its tick. */
    private record StrikeTemplate(BigDecimal latitude, BigDecimal longitude,
                                  Duration offsetBeforeTick, String type) {

        NeaLightningStrike resolveAgainst(Instant tickObservedAt) {
            return new NeaLightningStrike(latitude, longitude, tickObservedAt.minus(offsetBeforeTick), type);
        }
    }

    private record FrameTemplate(List<StrikeTemplate> strikes) {

        NeaLightningObservation resolveAgainst(Instant now) {
            List<NeaLightningStrike> resolved = strikes.stream()
                    .map(strike -> strike.resolveAgainst(now))
                    .toList();
            return new NeaLightningObservation(now, resolved, true);
        }
    }
}
