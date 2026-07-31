package com.crewsafe.identity;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

class DemoDataSeederMappingTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
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
        assertThat(DemoDataSeeder.parseAndValidateMappings(MAPPER, VALID))
                .singleElement()
                .extracting(DemoDataSeeder.DemoUserMapping::cognitoSub)
                .isEqualTo("00000000-0000-0000-0000-000000000001");
    }

    @Test
    void acceptsAnEmptyMappingForInitialSharedCognitoOnboarding() {
        assertThat(DemoDataSeeder.parseAndValidateMappings(MAPPER, "[]")).isEmpty();
    }

    @Test
    void rejectsMalformedAndEmailSubjectMappings() {
        assertThatIllegalArgumentException()
                .isThrownBy(() -> DemoDataSeeder.parseAndValidateMappings(MAPPER, "{"));
        assertThatIllegalArgumentException()
                .isThrownBy(() -> DemoDataSeeder.parseAndValidateMappings(
                        MAPPER, VALID.replace("00000000-0000-0000-0000-000000000001",
                                "person@example.com")));
    }

    @Test
    void rejectsDuplicateOrConflictingSubjects() {
        String duplicate = "[" + VALID.substring(1, VALID.length() - 2)
                + "," + VALID.substring(1, VALID.length() - 2)
                .replace("developer-one", "developer-two") + "]";

        assertThatIllegalArgumentException()
                .isThrownBy(() -> DemoDataSeeder.parseAndValidateMappings(MAPPER, duplicate));
    }

    @Test
    void rejectsUnknownIdentityKindsAndSites() {
        assertThatIllegalArgumentException()
                .isThrownBy(() -> DemoDataSeeder.parseAndValidateMappings(
                        MAPPER, VALID.replace("\"developer\"", "\"inactive\"")));
        assertThatIllegalArgumentException()
                .isThrownBy(() -> DemoDataSeeder.parseAndValidateMappings(
                        MAPPER, VALID.replace("\"bishan\"", "\"unknown-site\"")));
    }

    @Test
    void acceptsSyntheticEmailNamespaceAndExplicitStatus() {
        String synthetic = VALID
                .replace("developer-one", "synthetic-worker@synthetic.crewsafe.invalid")
                .replace("Developer One", "Synthetic Demo Worker")
                .replace("\"developer\"", "\"synthetic-test\"")
                .replace("\"preserve\"", "\"enabled\"")
                .replace("\"SUPERVISOR\"", "\"WORKER\"");

        assertThat(DemoDataSeeder.parseAndValidateMappings(MAPPER, synthetic))
                .singleElement()
                .satisfies(mapping -> {
                    assertThat(mapping.identityKind()).isEqualTo("synthetic-test");
                    assertThat(mapping.desiredStatus()).isEqualTo("enabled");
                });
    }

    @Test
    void rejectsMissingOrUnsupportedStatusAndCrossKindUsernames() {
        assertThatIllegalArgumentException()
                .isThrownBy(() -> DemoDataSeeder.parseAndValidateMappings(
                        MAPPER, VALID.replace(
                                "\"desiredStatus\":\"preserve\"", "\"unexpected\":\"preserve\"")));
        assertThatIllegalArgumentException()
                .isThrownBy(() -> DemoDataSeeder.parseAndValidateMappings(
                        MAPPER, VALID.replace("\"preserve\"", "\"enabled\"")));
        assertThatIllegalArgumentException()
                .isThrownBy(() -> DemoDataSeeder.parseAndValidateMappings(
                        MAPPER, VALID.replace("developer-one",
                                "person@example.com")));
    }
}
