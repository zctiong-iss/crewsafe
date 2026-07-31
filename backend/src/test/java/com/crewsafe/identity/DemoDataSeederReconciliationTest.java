package com.crewsafe.identity;

import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.SiteMembership;
import com.crewsafe.identity.domain.UserStatus;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.repository.SiteMembershipRepository;
import com.crewsafe.identity.security.CognitoProperties;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalStateException;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class DemoDataSeederReconciliationTest {

    private static final String BISHAN_NAME = "Bishan Park Landscaping";
    private static final String CAMPUS_NAME = "NUS Campus Maintenance";
    private static final String FIRST_SUB = "00000000-0000-0000-0000-000000000001";
    private static final String SECOND_SUB = "00000000-0000-0000-0000-000000000002";

    @Mock
    private AppUserRepository users;

    @Mock
    private SiteRepository sites;

    @Mock
    private SiteMembershipRepository memberships;

    private final CognitoProperties properties = new CognitoProperties();
    private final Map<String, AppUser> usersByUsername = new HashMap<>();
    private final Map<String, AppUser> usersBySub = new HashMap<>();
    private final List<SiteMembership> storedMemberships = new ArrayList<>();
    private Site bishan;
    private Site campus;
    private DemoDataSeeder seeder;

    @BeforeEach
    void setUp() {
        bishan = new Site(BISHAN_NAME,
                new BigDecimal("1.362200"), new BigDecimal("103.845500"));
        campus = new Site(CAMPUS_NAME,
                new BigDecimal("1.296600"), new BigDecimal("103.776400"));

        when(sites.findByName(BISHAN_NAME)).thenReturn(Optional.of(bishan));
        when(sites.findByName(CAMPUS_NAME)).thenReturn(Optional.of(campus));
        when(users.findByUsername(anyString()))
                .thenAnswer(invocation -> Optional.ofNullable(
                        usersByUsername.get(invocation.getArgument(0))));
        when(users.findByCognitoSub(anyString()))
                .thenAnswer(invocation -> Optional.ofNullable(
                        usersBySub.get(invocation.getArgument(0))));
        when(users.findAll()).thenAnswer(invocation -> List.copyOf(usersByUsername.values()));
        when(users.save(any(AppUser.class))).thenAnswer(invocation -> {
            AppUser user = invocation.getArgument(0);
            usersByUsername.put(user.getUsername(), user);
            usersBySub.put(user.getCognitoSub(), user);
            return user;
        });
        when(memberships.findByUserId(any()))
                .thenAnswer(invocation -> storedMemberships.stream()
                        .filter(membership -> membership.getUserId().equals(invocation.getArgument(0)))
                        .toList());
        when(memberships.save(any(SiteMembership.class))).thenAnswer(invocation -> {
            SiteMembership membership = invocation.getArgument(0);
            storedMemberships.add(membership);
            return membership;
        });
        doAnswer(invocation -> {
            Iterable<SiteMembership> removed = invocation.getArgument(0);
            removed.forEach(storedMemberships::remove);
            return null;
        }).when(memberships).deleteAll(any(List.class));

        seeder = new DemoDataSeeder(users, sites, memberships, properties, new ObjectMapper());
    }

    @Test
    void startsWithNoMappingsAndDoesNotCreateApplicationUsers() {
        properties.setDemoUsersJson("[]");

        seeder.run(null);

        assertThat(usersByUsername).isEmpty();
        assertThat(storedMemberships).isEmpty();
        verify(users, never()).save(any());
    }

    @Test
    void createsANonLegacyFirstIdentityAndRepeatedStartupIsIdempotent() {
        properties.setDemoUsersJson(firstMapping());

        seeder.run(null);
        seeder.run(null);

        assertThat(usersByUsername)
                .containsOnlyKeys("worker.bishan@synthetic.crewsafe.invalid");
        assertThat(storedMemberships)
                .singleElement()
                .extracting(SiteMembership::getSiteId)
                .isEqualTo(bishan.getId());
    }

    @Test
    void addsAnotherIdentityOnALaterStartupWithoutDuplicatingTheFirst() {
        properties.setDemoUsersJson(firstMapping());
        seeder.run(null);

        properties.setDemoUsersJson(twoMappings());
        seeder.run(null);

        assertThat(usersByUsername)
                .containsOnlyKeys(
                        "worker.bishan@synthetic.crewsafe.invalid",
                        "supervisor.campus@synthetic.crewsafe.invalid");
        assertThat(storedMemberships).hasSize(2);
    }

    @Test
    void refusesToRebindAnExistingUsernameToAnotherImmutableSubject() {
        AppUser existing = store(new AppUser(
                "worker.bishan@synthetic.crewsafe.invalid",
                FIRST_SUB, "Existing User", Role.WORKER));
        properties.setDemoUsersJson(firstMapping().replace(FIRST_SUB, SECOND_SUB));

        assertThatIllegalStateException()
                .isThrownBy(() -> seeder.run(null))
                .withMessageContaining("immutable Cognito subject");

        assertThat(usersByUsername.get(
                "worker.bishan@synthetic.crewsafe.invalid")).isSameAs(existing);
        assertThat(usersBySub).containsOnlyKeys(FIRST_SUB);
    }

    @Test
    void refusesToBindAnExistingSubjectToAnotherUsername() {
        AppUser existing = store(new AppUser(
                "existing-user", FIRST_SUB, "Existing User", Role.WORKER));
        properties.setDemoUsersJson(firstMapping());

        assertThatIllegalStateException()
                .isThrownBy(() -> seeder.run(null))
                .withMessageContaining("immutable Cognito subject");

        assertThat(usersBySub.get(FIRST_SUB)).isSameAs(existing);
        assertThat(usersByUsername).containsOnlyKeys("existing-user");
    }

    @Test
    void reviewedEnabledStatusReactivatesWhileReconcilingMetadata() {
        AppUser existing = store(new AppUser(
                "worker.bishan@synthetic.crewsafe.invalid",
                FIRST_SUB, "Old Display", Role.SUPERVISOR));
        existing.setStatus(UserStatus.INACTIVE);
        properties.setDemoUsersJson(firstMapping());

        seeder.run(null);

        assertThat(existing.getStatus()).isEqualTo(UserStatus.ACTIVE);
        assertThat(existing.getDisplayName()).isEqualTo("Synthetic Bishan Worker");
        assertThat(existing.getRole()).isEqualTo(Role.WORKER);
    }

    @Test
    void developerMappingPreservesAnOperatorDisabledStatus() {
        AppUser existing = store(new AppUser(
                "developer-one", FIRST_SUB, "Old Display", Role.SUPERVISOR));
        existing.setStatus(UserStatus.INACTIVE);
        properties.setDemoUsersJson(developerMapping());

        seeder.run(null);

        assertThat(existing.getStatus()).isEqualTo(UserStatus.INACTIVE);
        assertThat(existing.getDisplayName()).isEqualTo("Developer One");
    }

    @Test
    void reconcilesMembershipsToExactlyTheReviewedSiteSet() {
        AppUser existing = store(new AppUser(
                "worker.bishan@synthetic.crewsafe.invalid",
                FIRST_SUB, "Old Display", Role.WORKER));
        storedMemberships.add(new SiteMembership(existing.getId(), campus.getId()));
        properties.setDemoUsersJson(firstMapping());

        seeder.run(null);

        assertThat(storedMemberships)
                .singleElement()
                .extracting(SiteMembership::getSiteId)
                .isEqualTo(bishan.getId());
    }

    @Test
    void removingAMappingPreservesItsLocalApplicationUser() {
        AppUser existing = store(new AppUser(
                "worker.bishan@synthetic.crewsafe.invalid",
                FIRST_SUB, "Synthetic Bishan Worker", Role.WORKER));
        properties.setDemoUsersJson("[]");

        seeder.run(null);

        assertThat(existing.getStatus()).isEqualTo(UserStatus.ACTIVE);
    }

    @Test
    void explicitDisabledStatusMakesTheMappedUserInactive() {
        AppUser existing = store(new AppUser(
                "worker.bishan@synthetic.crewsafe.invalid",
                FIRST_SUB, "Synthetic Bishan Worker", Role.WORKER));
        properties.setDemoUsersJson(firstMapping().replace(
                "\"desiredStatus\":\"enabled\"", "\"desiredStatus\":\"disabled\""));

        seeder.run(null);

        assertThat(existing.getStatus()).isEqualTo(UserStatus.INACTIVE);
    }

    private AppUser store(AppUser user) {
        usersByUsername.put(user.getUsername(), user);
        usersBySub.put(user.getCognitoSub(), user);
        return user;
    }

    private static String firstMapping() {
        return """
                [{
                  "username":"worker.bishan@synthetic.crewsafe.invalid",
                  "cognitoSub":"%s",
                  "displayName":"Synthetic Bishan Worker",
                  "role":"WORKER",
                  "siteCodes":["bishan"],
                  "identityKind":"synthetic-test",
                  "desiredStatus":"enabled"
                }]
                """.formatted(FIRST_SUB);
    }

    private static String twoMappings() {
        return """
                [
                  {
                    "username":"worker.bishan@synthetic.crewsafe.invalid",
                    "cognitoSub":"%s",
                    "displayName":"Synthetic Bishan Worker",
                    "role":"WORKER",
                    "siteCodes":["bishan"],
                    "identityKind":"synthetic-test",
                    "desiredStatus":"enabled"
                  },
                  {
                    "username":"supervisor.campus@synthetic.crewsafe.invalid",
                    "cognitoSub":"%s",
                    "displayName":"Synthetic Campus Supervisor",
                    "role":"SUPERVISOR",
                    "siteCodes":["campus"],
                    "identityKind":"synthetic-test",
                    "desiredStatus":"enabled"
                  }
                ]
                """.formatted(FIRST_SUB, SECOND_SUB);
    }

    private static String developerMapping() {
        return """
                [{
                  "username":"developer-one",
                  "cognitoSub":"%s",
                  "displayName":"Developer One",
                  "role":"SUPERVISOR",
                  "siteCodes":["bishan"],
                  "identityKind":"developer",
                  "desiredStatus":"preserve"
                }]
                """.formatted(FIRST_SUB);
    }
}
