package com.crewsafe.policy.domain;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The seeded baseline is defined twice — once in {@link MomHeatPolicyDefaults} for sites created
 * after the migration, and once in {@code V17__seed_default_policy_version.sql} for the ones that
 * already existed. A Flyway migration cannot call Java, so the duplication is unavoidable; what is
 * avoidable is the two copies silently disagreeing, which would mean a site's heat thresholds
 * depended on whether it was created before or after a migration ran.
 *
 * <p>These tests are what makes that duplication safe to live with (SCRUM-432).
 *
 * @author Abu Bakar
 */
class MomHeatPolicyDefaultsTest {

    private static final Path MIGRATION =
            Path.of("src/main/resources/db/migration/V17__seed_default_policy_version.sql");

    /**
     * The twelve thresholds in the order the migration's SELECT lists them:
     * unacclimatised light/moderate/heavy, partial light/moderate/heavy,
     * full light/moderate/heavy, then the emergency stop.
     */
    private static final List<BigDecimal> JAVA_THRESHOLDS = List.of(
            MomHeatPolicyDefaults.UNACCLIMATISED_LIGHT,
            MomHeatPolicyDefaults.UNACCLIMATISED_MODERATE,
            MomHeatPolicyDefaults.UNACCLIMATISED_HEAVY,
            MomHeatPolicyDefaults.PARTIAL_LIGHT,
            MomHeatPolicyDefaults.PARTIAL_MODERATE,
            MomHeatPolicyDefaults.PARTIAL_HEAVY,
            MomHeatPolicyDefaults.FULL_LIGHT,
            MomHeatPolicyDefaults.FULL_MODERATE,
            MomHeatPolicyDefaults.FULL_HEAVY,
            MomHeatPolicyDefaults.EMERGENCY_STOP);

    @Test
    @DisplayName("The migration seeds exactly the thresholds this class defines, in the same order")
    void migrationAndJavaAgreeOnEveryThreshold() throws IOException {
        List<BigDecimal> fromSql = thresholdsInMigration();

        assertThat(fromSql)
                .as("V17's SELECT must list the same twelve thresholds as MomHeatPolicyDefaults; "
                        + "if you changed one, change both")
                .usingElementComparator(BigDecimal::compareTo)
                .containsExactlyElementsOf(JAVA_THRESHOLDS);
    }

    @Test
    @DisplayName("The migration seeds the same version label, so both paths cite one rule version")
    void migrationAndJavaAgreeOnTheVersionLabel() throws IOException {
        assertThat(Files.readString(MIGRATION))
                .as("a recommendation must cite the same policy version whether the site was "
                        + "seeded by the migration or created afterwards")
                .contains("'" + MomHeatPolicyDefaults.VERSION_LABEL + "'")
                .contains("'" + MomHeatPolicyDefaults.SOURCE + "'");
    }

    @Test
    @DisplayName("The migration never overwrites a policy someone configured")
    void migrationSkipsSitesThatAlreadyHaveAnActiveVersion() throws IOException {
        String sql = Files.readString(MIGRATION).replaceAll("\\s+", " ");

        assertThat(sql)
                .as("without the NOT EXISTS guard this would either overwrite a configured policy "
                        + "or violate uq_policy_version_active_per_site on re-run")
                .containsIgnoringCase("where not exists")
                .containsIgnoringCase("pv.status = 'ACTIVE'");
    }

    @Test
    @DisplayName("The seeded version is ACTIVE — a DRAFT one would leave the engine just as inert")
    void seededVersionIsActive() {
        PolicyVersion seeded = MomHeatPolicyDefaults.activeVersionFor(UUID.randomUUID(), LocalDate.now());

        assertThat(seeded.getStatus()).isEqualTo(PolicyVersionStatus.ACTIVE);
    }

    @Test
    @DisplayName("createdBy is null: the system provided this, no Safety Manager signed it off")
    void seededVersionHasNoHumanAuthor() {
        PolicyVersion seeded = MomHeatPolicyDefaults.activeVersionFor(UUID.randomUUID(), LocalDate.now());

        assertThat(seeded.getCreatedBy())
                .as("null is what distinguishes a seeded baseline from a configured policy, and "
                        + "matches the convention V12 used for carried-forward versions")
                .isNull();
    }

    @Test
    @DisplayName("Thresholds get stricter as acclimatisation decreases, at every intensity")
    void strictnessOrderingHolds() {
        // Not a restatement of the numbers: this is the property that makes them safe. An
        // unacclimatised worker must never be allowed to work in heat a fully acclimatised one
        // would be rested in. A typo that swapped two tiers would pass an equality test and fail
        // this one.
        assertThat(MomHeatPolicyDefaults.UNACCLIMATISED_LIGHT)
                .isLessThan(MomHeatPolicyDefaults.PARTIAL_LIGHT);
        assertThat(MomHeatPolicyDefaults.PARTIAL_LIGHT)
                .isLessThan(MomHeatPolicyDefaults.FULL_LIGHT);

        assertThat(MomHeatPolicyDefaults.UNACCLIMATISED_MODERATE)
                .isLessThan(MomHeatPolicyDefaults.PARTIAL_MODERATE);
        assertThat(MomHeatPolicyDefaults.PARTIAL_MODERATE)
                .isLessThan(MomHeatPolicyDefaults.FULL_MODERATE);

        assertThat(MomHeatPolicyDefaults.UNACCLIMATISED_HEAVY)
                .isLessThan(MomHeatPolicyDefaults.PARTIAL_HEAVY);
        assertThat(MomHeatPolicyDefaults.PARTIAL_HEAVY)
                .isLessThan(MomHeatPolicyDefaults.FULL_HEAVY);
    }

    @Test
    @DisplayName("Heavier work has a lower threshold than lighter work, at every acclimatisation tier")
    void heavierWorkIsAlwaysStricter() {
        assertThat(MomHeatPolicyDefaults.UNACCLIMATISED_HEAVY)
                .isLessThan(MomHeatPolicyDefaults.UNACCLIMATISED_MODERATE);
        assertThat(MomHeatPolicyDefaults.UNACCLIMATISED_MODERATE)
                .isLessThan(MomHeatPolicyDefaults.UNACCLIMATISED_LIGHT);

        assertThat(MomHeatPolicyDefaults.PARTIAL_HEAVY)
                .isLessThan(MomHeatPolicyDefaults.PARTIAL_MODERATE);
        assertThat(MomHeatPolicyDefaults.PARTIAL_MODERATE)
                .isLessThan(MomHeatPolicyDefaults.PARTIAL_LIGHT);

        assertThat(MomHeatPolicyDefaults.FULL_HEAVY)
                .isLessThan(MomHeatPolicyDefaults.FULL_MODERATE);
        assertThat(MomHeatPolicyDefaults.FULL_MODERATE)
                .isLessThan(MomHeatPolicyDefaults.FULL_LIGHT);
    }

    @Test
    @DisplayName("The emergency stop sits above every work threshold and matches MOM Band 3")
    void emergencyStopIsTheCeiling() {
        assertThat(MomHeatPolicyDefaults.EMERGENCY_STOP)
                .as("MOM Band 3: all work ceases at or above 33C")
                .isEqualByComparingTo("33.0")
                .isGreaterThan(MomHeatPolicyDefaults.FULL_LIGHT);
    }

    /**
     * Pulls the numeric literals out of the migration's SELECT list. Deliberately anchored to the
     * commented threshold rows rather than every number in the file, so the version label's own
     * digits and the SCRUM reference cannot be mistaken for thresholds.
     */
    private static List<BigDecimal> thresholdsInMigration() throws IOException {
        String sql = Files.readString(MIGRATION);
        Matcher block = Pattern
                .compile("(?s)'ACTIVE',\\s*+(.*?)'Seeded automatically")
                .matcher(sql);
        assertThat(block.find())
                .as("could not locate V17's threshold block; did the migration's shape change?")
                .isTrue();

        Matcher numbers = Pattern.compile("(\\d++\\.\\d++)").matcher(block.group(1));
        List<BigDecimal> found = new ArrayList<>();
        while (numbers.find()) {
            found.add(new BigDecimal(numbers.group(1)));
        }
        return found;
    }
}
