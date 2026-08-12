package com.crewsafe.mitigation.domain;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import java.util.TreeSet;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The catalogue's job is to guarantee that anything reaching a worker has a translation
 * (SCRUM-119).
 *
 * <p>The load-bearing test is {@link #everyDispatchableCodeIsTranslatedInEveryLocale()}. The other
 * cases check the mapping in isolation; that one checks the actual promise, against the actual
 * files the app ships, so a code added here without a translation fails the build rather than
 * reaching a worker as English they may not read.
 *
 * @author Justin Chua
 */
class ActionCatalogueTest {

    private static final Path LOCALES = Path.of("..", "mobile", "src", "localization");
    private static final String[] LANGUAGES = {"en", "zh-Hans", "hi", "ms", "ta", "bn", "my"};

    @Test
    void mapsRecurringCodesToTheirOneShotDispatchForm() {
        // Mobile recovers the duration with REST_(\d+)_MIN (SCRUM-206). Handing it the _HOURLY
        // form leaves it matching a prefix and silently dropping the recurrence.
        assertThat(ActionCatalogue.toDispatchCode("REST_15_MIN_HOURLY")).contains("REST_15_MIN");
        assertThat(ActionCatalogue.toDispatchCode("REST_10_MIN_HOURLY")).contains("REST_10_MIN");
        assertThat(ActionCatalogue.toDispatchCode("HYDRATE_HOURLY")).contains("HYDRATE");
        assertThat(ActionCatalogue.toDispatchCode("SHADE_RECOVERY")).contains("SEEK_SHADE");
    }

    @Test
    void dispatchesEverythingElseAsItself() {
        assertThat(ActionCatalogue.toDispatchCode("STOP_WORK")).contains("STOP_WORK");
        assertThat(ActionCatalogue.toDispatchCode("ROTATE_TO_LIGHT_DUTY")).contains("ROTATE_TO_LIGHT_DUTY");
    }

    @Test
    void refusesToDispatchACodeItDoesNotKnow() {
        // Empty rather than identity: an unknown code must not be dispatchable by falling through.
        assertThat(ActionCatalogue.toDispatchCode("SEEK_SHELTER_NOW")).isEmpty();
        assertThat(ActionCatalogue.toDispatchCode(null)).isEmpty();
        assertThat(ActionCatalogue.isKnown("SEEK_SHELTER_NOW")).isFalse();
    }

    @Test
    void carriesNoLightningInstruction() {
        // §7.1 requires "seek proper shelter", and shade is not shelter from lightning. That
        // instruction reaches workers as translated banner copy instead, and must never be
        // approximated by an action code. See the class doc on ActionCatalogue.
        assertThat(ActionCatalogue.knownCodes())
                .noneMatch(code -> code.contains("SHELTER") || code.contains("LIGHTNING"));
    }

    @Test
    void everyDispatchableCodeIsTranslatedInEveryLocale() throws IOException {
        ObjectMapper mapper = new ObjectMapper();

        Set<String> dispatchable = new TreeSet<>();
        for (String code : ActionCatalogue.knownCodes()) {
            ActionCatalogue.toDispatchCode(code).ifPresent(dispatchable::add);
        }
        assertThat(dispatchable).isNotEmpty();

        for (String language : LANGUAGES) {
            Path file = LOCALES.resolve(language + ".json");
            assertThat(file).as("locale file for %s", language).exists();

            var actions = mapper.readTree(Files.readString(file)).get("actions");
            assertThat(actions).as("actions block in %s.json", language).isNotNull();

            for (String code : dispatchable) {
                assertThat(actions.hasNonNull(code))
                        .as("%s.json is missing actions.%s — a worker reading %s would be shown "
                                + "humanised English instead", language, code, language)
                        .isTrue();
            }
        }
    }
}
