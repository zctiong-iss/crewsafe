package com.crewsafe.identity;

import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.SiteMembership;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.repository.SiteMembershipRepository;
import com.crewsafe.identity.security.CognitoProperties;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.cognitoidentityprovider.CognitoIdentityProviderClient;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminGetUserRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminGetUserResponse;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AttributeType;

import java.math.BigDecimal;
import java.net.URI;
import java.util.List;

/**
 * Seeds synthetic demo accounts, sites and memberships.
 *
 * All identities are fictional — the project uses no real worker data.
 *
 * Restricted to the local and staging profiles so it can never run in a production-demo
 * deployment. Accounts are administered (FR-01), so this class does not create them — it
 * expects the seven demo usernames to already exist in the Cognito user pool (pre-provisioned
 * in infra/local/cognito-local for local dev, or created via the AWS CLI for staging) and
 * only backfills each one's {@code sub} plus its local role and site memberships.
 */
@Component
@Profile({"local", "staging"})
@RequiredArgsConstructor
@Slf4j
public class DemoDataSeeder implements ApplicationRunner {

    private final AppUserRepository users;
    private final SiteRepository sites;
    private final SiteMembershipRepository memberships;
    private final CognitoProperties cognitoProperties;

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (users.existsByUsername("supervisor1")) {
            log.info("Demo data already present - skipping seeding.");
            return;
        }

        try (CognitoIdentityProviderClient cognito = cognitoClient()) {
            // Two sites. The second exists so that "user cannot reach a site they are not
            // assigned to" is testable — with only one site the rule is unfalsifiable.
            Site bishan = sites.save(new Site("Bishan Park Landscaping",
                    new BigDecimal("1.362200"), new BigDecimal("103.845500")));
            Site campus = sites.save(new Site("NUS Campus Maintenance",
                    new BigDecimal("1.296600"), new BigDecimal("103.776400")));

            AppUser supervisor1 = users.save(newUser(cognito, "supervisor1", "Aisyah (Supervisor)", Role.SUPERVISOR));
            AppUser supervisor2 = users.save(newUser(cognito, "supervisor2", "Rajesh (Supervisor)", Role.SUPERVISOR));
            AppUser worker1 = users.save(newUser(cognito, "worker1", "Meng Hui (Worker)", Role.WORKER));
            AppUser worker2 = users.save(newUser(cognito, "worker2", "Siti (Worker)", Role.WORKER));
            AppUser worker3 = users.save(newUser(cognito, "worker3", "Kumar (Worker)", Role.WORKER));
            AppUser manager1 = users.save(newUser(cognito, "manager1", "Wei Ling (Safety Manager)", Role.SAFETY_MANAGER));
            users.save(newUser(cognito, "admin1", "System Administrator", Role.ADMIN));

            // Bishan crew: one supervisor, three workers.
            memberships.saveAll(List.of(
                    new SiteMembership(supervisor1.getId(), bishan.getId()),
                    new SiteMembership(worker1.getId(), bishan.getId()),
                    new SiteMembership(worker2.getId(), bishan.getId()),
                    new SiteMembership(worker3.getId(), bishan.getId())
            ));

            // Campus crew: a different supervisor, deliberately with no Bishan access.
            memberships.save(new SiteMembership(supervisor2.getId(), campus.getId()));

            // The safety manager oversees both sites.
            memberships.saveAll(List.of(
                    new SiteMembership(manager1.getId(), bishan.getId()),
                    new SiteMembership(manager1.getId(), campus.getId())
            ));

            log.info("Seeded 7 demo users across 2 sites ({}, {}).", bishan.getName(), campus.getName());
        }
    }

    private AppUser newUser(CognitoIdentityProviderClient cognito, String username, String displayName, Role role) {
        return new AppUser(username, subFor(cognito, username), displayName, role);
    }

    /**
     * Looks up the Cognito-assigned {@code sub} for an already-provisioned demo user.
     * Fails loudly rather than skipping the account: a missing Cognito user means the pool
     * was not set up correctly, and a role- and site-less silent skip would be a confusing
     * way to discover that.
     */
    private String subFor(CognitoIdentityProviderClient cognito, String username) {
        AdminGetUserResponse response = cognito.adminGetUser(AdminGetUserRequest.builder()
                .userPoolId(cognitoProperties.getUserPoolId())
                .username(username)
                .build());

        return response.userAttributes().stream()
                .filter(attribute -> "sub".equals(attribute.name()))
                .findFirst()
                .map(AttributeType::value)
                .orElseThrow(() -> new IllegalStateException("Cognito user " + username + " has no sub attribute"));
    }

    private CognitoIdentityProviderClient cognitoClient() {
        var builder = CognitoIdentityProviderClient.builder()
                .region(Region.of(cognitoProperties.getRegion()));

        // Blank, not just null: an unset COGNITO_ENDPOINT_OVERRIDE binds to an empty string
        // rather than null, and an empty endpoint must mean "talk to real AWS".
        if (StringUtils.hasText(cognitoProperties.getEndpointOverride())) {
            // cognito-local accepts any credentials; it never checks the signature.
            builder.endpointOverride(URI.create(cognitoProperties.getEndpointOverride()))
                    .credentialsProvider(StaticCredentialsProvider.create(
                            AwsBasicCredentials.create("local", "local")));
        }

        return builder.build();
    }
}
