package com.crewsafe.identity;

import com.crewsafe.site.domain.Site;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;
import static org.assertj.core.api.Assertions.assertThatIllegalStateException;

class DemoDataSeederMappingTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final Set<String> KNOWN_SITE_CODES = Set.of("bishan", "campus");
    private static final String VALID = """
            [{
              "username":"developer-one",
              "cognitoSub":"00000000-0000-0000-0000-000000000001",
              "displayName":"Developer One",
              "role":"SUPERVISOR",
              "siteCodes":["bishan"],
              "identityKind":"developer",
              "desiredStatus":"preserve"
            }]
            """;

    @Test
    void acceptsAValidatedImmutableSubjectMappingWithoutCognitoCalls() {
        assertThat(DemoDataSeeder.parseAndValidateMappings(MAPPER, VALID, KNOWN_SITE_CODES))
                .singleElement()
                .extracting(DemoDataSeeder.DemoUserMapping::cognitoSub)
                .isEqualTo("00000000-0000-0000-0000-000000000001");
    }

    @Test
    void acceptsAnEmptyMappingForInitialSharedCognitoOnboarding() {
        assertThat(DemoDataSeeder.parseAndValidateMappings(MAPPER, "[]", KNOWN_SITE_CODES)).isEmpty();
    }

    @Test
    void rejectsMalformedAndEmailSubjectMappings() {
        assertThatIllegalArgumentException()
                .isThrownBy(() -> DemoDataSeeder.parseAndValidateMappings(MAPPER, "{", KNOWN_SITE_CODES));
        assertThatIllegalArgumentException()
                .isThrownBy(() -> DemoDataSeeder.parseAndValidateMappings(
                        MAPPER, VALID.replace("00000000-0000-0000-0000-000000000001",
                                "person@example.com"), KNOWN_SITE_CODES));
    }

    @Test
    void rejectsDuplicateOrConflictingSubjects() {
        String duplicate = "[" + VALID.substring(1, VALID.length() - 2)
                + "," + VALID.substring(1, VALID.length() - 2)
                .replace("developer-one", "developer-two") + "]";

        assertThatIllegalArgumentException()
                .isThrownBy(() -> DemoDataSeeder.parseAndValidateMappings(
                        MAPPER, duplicate, KNOWN_SITE_CODES));
    }

    @Test
    void rejectsUnknownIdentityKindsAndSites() {
        assertThatIllegalArgumentException()
                .isThrownBy(() -> DemoDataSeeder.parseAndValidateMappings(
                        MAPPER, VALID.replace("\"developer\"", "\"inactive\""), KNOWN_SITE_CODES));
        assertThatIllegalArgumentException()
                .isThrownBy(() -> DemoDataSeeder.parseAndValidateMappings(
                        MAPPER, VALID.replace("\"bishan\"", "\"unknown-site\""), KNOWN_SITE_CODES));
    }

    @Test
    void acceptsSyntheticEmailNamespaceAndExplicitStatus() {
        String synthetic = VALID
                .replace("developer-one", "synthetic-worker@synthetic.crewsafe.invalid")
                .replace("Developer One", "Synthetic Demo Worker")
                .replace("\"developer\"", "\"synthetic-test\"")
                .replace("\"preserve\"", "\"enabled\"")
                .replace("\"SUPERVISOR\"", "\"WORKER\"");

        assertThat(DemoDataSeeder.parseAndValidateMappings(MAPPER, synthetic, KNOWN_SITE_CODES))
                .singleElement()
                .satisfies(mapping -> {
                    assertThat(mapping.identityKind()).isEqualTo("synthetic-test");
                    assertThat(mapping.desiredStatus()).isEqualTo("enabled");
                });
    }

    @Test
    void acceptsAnEmailShapedDeveloperUsernameInTheSyntheticNamespace() {
        // A developer identity that needs to exist on the live shared pool
        // (username_attributes=["email"]) — still "developer" kind and "preserve" status,
        // just shaped like the email that pool requires.
        String emailShaped = VALID.replace("developer-one", "admin1@synthetic.crewsafe.invalid");

        assertThat(DemoDataSeeder.parseAndValidateMappings(MAPPER, emailShaped, KNOWN_SITE_CODES))
                .singleElement()
                .satisfies(mapping -> {
                    assertThat(mapping.identityKind()).isEqualTo("developer");
                    assertThat(mapping.username()).isEqualTo("admin1@synthetic.crewsafe.invalid");
                });
    }

    @Test
    void rejectsMissingOrUnsupportedStatusAndCrossKindUsernames() {
        assertThatIllegalArgumentException()
                .isThrownBy(() -> DemoDataSeeder.parseAndValidateMappings(
                        MAPPER, VALID.replace(
                                "\"desiredStatus\":\"preserve\"", "\"unexpected\":\"preserve\""),
                        KNOWN_SITE_CODES));
        assertThatIllegalArgumentException()
                .isThrownBy(() -> DemoDataSeeder.parseAndValidateMappings(
                        MAPPER, VALID.replace("\"preserve\"", "\"enabled\""), KNOWN_SITE_CODES));
        assertThatIllegalArgumentException()
                .isThrownBy(() -> DemoDataSeeder.parseAndValidateMappings(
                        MAPPER, VALID.replace("developer-one",
                                "person@example.com"), KNOWN_SITE_CODES));
    }

    // ----------------------------------------------------------------------------------
    // SCRUM-490 — site allowlist is no longer two literals baked into this class (T003)
    // ----------------------------------------------------------------------------------

    @Test
    void acceptsASiteCodeThatIsOnlyKnownThroughTheSuppliedAllowlistNotALegacyLiteral() {
        // "riverside" is not bishan/campus and never was — this proves the check is driven by
        // whatever Set<String> is passed in, not by a literal still baked into the method.
        String mapping = VALID.replace("\"bishan\"", "\"riverside\"");

        assertThat(DemoDataSeeder.parseAndValidateMappings(
                        MAPPER, mapping, Set.of("riverside")))
                .singleElement()
                .extracting(DemoDataSeeder.DemoUserMapping::siteCodes)
                .isEqualTo(List.of("riverside"));
    }

    @Test
    void rejectsASiteCodeAbsentFromTheSuppliedAllowlistEvenIfItWasOnceLegacy() {
        // bishan is rejected here purely because it is missing from the allowlist passed to
        // this call, not because of any hard-coded rule — the mechanism, not the specific code.
        assertThatIllegalArgumentException()
                .isThrownBy(() -> DemoDataSeeder.parseAndValidateMappings(
                        MAPPER, VALID, Set.of("campus")));
    }

    // ----------------------------------------------------------------------------------
    // SCRUM-490 — FR-001a: the Java-side site definitions and the shared allowlist must agree
    // ----------------------------------------------------------------------------------

    @Test
    void validateSiteDefinitionsAreKnownRejectsADefinitionAbsentFromTheAllowlist() {
        Map<String, DemoDataSeeder.SiteDefinition> definitions = Map.of(
                "bishan", siteDefinition("bishan"),
                "ghost", siteDefinition("ghost"));

        assertThatIllegalStateException()
                .isThrownBy(() -> DemoDataSeeder.validateSiteDefinitionsAreKnown(
                        definitions, Set.of("bishan")))
                .withMessageContaining("ghost");
    }

    @Test
    void validateSiteDefinitionsAreKnownAcceptsADefinitionSetThatIsASubsetOfTheAllowlist() {
        Map<String, DemoDataSeeder.SiteDefinition> definitions = Map.of("bishan", siteDefinition("bishan"));

        assertThatCode(() -> DemoDataSeeder.validateSiteDefinitionsAreKnown(
                        definitions, Set.of("bishan", "campus")))
                .doesNotThrowAnyException();
    }

    // ----------------------------------------------------------------------------------
    // SCRUM-490 — US1 (T009): the site-resolution mechanism is generic, not a two-site special
    // case. Proven without touching production data: an arbitrary, previously-unseen
    // SiteDefinition resolves through the same code path bishan/campus already use.
    // ----------------------------------------------------------------------------------

    @Test
    void resolveManagedSitesResolvesEveryDeclaredDefinitionRegardlessOfHowManyThereAre() {
        DemoDataSeeder.SiteDefinition testSite = new DemoDataSeeder.SiteDefinition(
                "testsite", "Test Site", new BigDecimal("1.0"), new BigDecimal("103.0"));
        Map<String, DemoDataSeeder.SiteDefinition> definitions = Map.of(
                "bishan", siteDefinition("bishan"),
                "testsite", testSite);

        Map<String, Site> resolved = DemoDataSeeder.resolveManagedSites(definitions,
                definition -> new Site(definition.displayName(),
                        definition.latitude(), definition.longitude()));

        assertThat(resolved).containsOnlyKeys("bishan", "testsite");
        assertThat(resolved.get("testsite").getName()).isEqualTo("Test Site");
    }

    private static DemoDataSeeder.SiteDefinition siteDefinition(String code) {
        return new DemoDataSeeder.SiteDefinition(
                code, "Display " + code, new BigDecimal("1.0"), new BigDecimal("103.0"));
    }
}
