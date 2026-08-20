package com.crewsafe.admin.service;

import com.crewsafe.admin.cognito.CognitoUserProvisioningService;
import com.crewsafe.common.audit.AuditService;
import com.crewsafe.common.error.BadRequestException;
import com.crewsafe.common.error.ConflictException;
import com.crewsafe.common.error.ErrorCode;
import com.crewsafe.common.error.ResourceNotFoundException;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.SiteMembership;
import com.crewsafe.identity.domain.UserStatus;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.repository.SiteMembershipRepository;
import com.crewsafe.site.repository.SiteRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link UserAdminService} (US-30).
 *
 * @author Jemilin Beulah
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("UserAdminService")
class UserAdminServiceTest {

    @Mock
    private AppUserRepository users;

    @Mock
    private SiteRepository sites;

    @Mock
    private SiteMembershipRepository memberships;

    @Mock
    private AuditService audit;

    @Mock
    private CognitoUserProvisioningService cognitoProvisioning;

    private static final String VALID_PASSWORD = "Valid-Password-123";

    private UserAdminService service;
    private UUID actorId;

    @BeforeEach
    void setUp() {
        service = new UserAdminService(users, sites, memberships, audit, cognitoProvisioning);
        actorId = UUID.randomUUID();

        when(users.save(any(AppUser.class))).thenAnswer(invocation -> invocation.getArgument(0));
    }

    private static AppUser user(Role role) {
        return new AppUser("someone", UUID.randomUUID().toString(), "Someone", role);
    }

    @Nested
    @DisplayName("register")
    class Register {

        @Test
        @DisplayName("Neither cognitoSub nor email → BadRequestException")
        void neitherSubNorEmail() {
            assertThatThrownBy(() -> service.register(
                    new UserAdminService.RegistrationIdentity("new-user", null, null, null), "Someone", Role.WORKER,
                    Set.of(), actorId))
                    .isInstanceOf(BadRequestException.class);

            verify(users, never()).save(any());
        }

        @Test
        @DisplayName("Both cognitoSub and email → BadRequestException")
        void bothSubAndEmail() {
            assertThatThrownBy(() -> service.register(
                    new UserAdminService.RegistrationIdentity("new-user", "sub-1",
                            "someone@synthetic.crewsafe.invalid", VALID_PASSWORD),
                    "Someone", Role.WORKER, Set.of(), actorId))
                    .isInstanceOf(BadRequestException.class);

            verify(users, never()).save(any());
        }

        @Test
        @DisplayName("Email without a password → BadRequestException")
        void emailWithoutPassword() {
            assertThatThrownBy(() -> service.register(
                    new UserAdminService.RegistrationIdentity(null, null, "someone@synthetic.crewsafe.invalid", null),
                    "Someone", Role.WORKER, Set.of(), actorId))
                    .isInstanceOf(BadRequestException.class);

            verify(users, never()).save(any());
            verify(cognitoProvisioning, never()).createUser(any(), any(), any());
        }

        @Test
        @DisplayName("cognitoSub without a username → BadRequestException")
        void cognitoSubWithoutUsername() {
            assertThatThrownBy(() -> service.register(
                    new UserAdminService.RegistrationIdentity(null, "sub-1", null, null), "Someone", Role.WORKER,
                    Set.of(), actorId))
                    .isInstanceOf(BadRequestException.class);

            verify(users, never()).save(any());
        }

        @Test
        @DisplayName("Duplicate username → ConflictException with USERNAME_ALREADY_REGISTERED")
        void duplicateUsername() {
            when(users.existsByUsername("taken")).thenReturn(true);

            assertThatThrownBy(() -> service.register(
                    new UserAdminService.RegistrationIdentity("taken", "sub-1", null, null), "Someone", Role.WORKER,
                    Set.of(), actorId))
                    .isInstanceOf(ConflictException.class)
                    .satisfies(e -> assertThat(((ConflictException) e).getCode())
                            .isEqualTo(ErrorCode.USERNAME_ALREADY_REGISTERED));

            verify(users, never()).save(any());
        }

        @Test
        @DisplayName("Duplicate cognitoSub → ConflictException")
        void duplicateSub() {
            when(users.existsByCognitoSub("sub-1")).thenReturn(true);

            assertThatThrownBy(() -> service.register(
                    new UserAdminService.RegistrationIdentity("new-user", "sub-1", null, null), "Someone",
                    Role.WORKER, Set.of(), actorId))
                    .isInstanceOf(ConflictException.class);

            verify(users, never()).save(any());
        }

        @Test
        @DisplayName("Unknown site id → ResourceNotFoundException")
        void unknownSite() {
            UUID siteId = UUID.randomUUID();
            when(sites.existsById(siteId)).thenReturn(false);

            assertThatThrownBy(() -> service.register(
                    new UserAdminService.RegistrationIdentity("new-user", "sub-1", null, null), "Someone",
                    Role.WORKER, Set.of(siteId), actorId))
                    .isInstanceOf(ResourceNotFoundException.class);

            verify(users, never()).save(any());
        }

        @Test
        @DisplayName("Unknown site id on the email path → ResourceNotFoundException, Cognito never called")
        void unknownSiteOnEmailPathNeverCallsCognito() {
            UUID siteId = UUID.randomUUID();
            when(sites.existsById(siteId)).thenReturn(false);

            assertThatThrownBy(() -> service.register(
                    new UserAdminService.RegistrationIdentity(null, null, "someone@synthetic.crewsafe.invalid",
                            VALID_PASSWORD),
                    "Someone", Role.WORKER, Set.of(siteId), actorId))
                    .isInstanceOf(ResourceNotFoundException.class);

            // Every local check must run before the external, non-transactional Cognito
            // call -- a doomed request must never leave a real orphaned identity behind.
            verify(cognitoProvisioning, never()).createUser(any(), any(), any());
            verify(users, never()).save(any());
        }

        @Test
        @DisplayName("Valid request with cognitoSub registers the user, grants sites and audits")
        void registersWithSubAndAudits() {
            UUID siteId = UUID.randomUUID();
            when(sites.existsById(siteId)).thenReturn(true);

            AppUser saved = service.register(
                    new UserAdminService.RegistrationIdentity("new-user", "sub-1", null, null), "Someone",
                    Role.SUPERVISOR, Set.of(siteId), actorId);

            assertThat(saved.getUsername()).isEqualTo("new-user");
            assertThat(saved.getRole()).isEqualTo(Role.SUPERVISOR);
            assertThat(saved.getEmail()).isNull();
            verify(memberships).save(any(SiteMembership.class));
            verify(cognitoProvisioning, never()).createUser(any(), any(), any());
            verify(audit).recordEvent(eq(actorId), eq("USER_REGISTERED"), eq("USER"), eq(saved.getId()), anyString());
        }

        @Test
        @DisplayName("Valid request with email provisions via Cognito, registers with username == email, and audits")
        void registersWithEmailAndAudits() {
            UUID siteId = UUID.randomUUID();
            when(sites.existsById(siteId)).thenReturn(true);
            when(cognitoProvisioning.createUser("new-user@synthetic.crewsafe.invalid", VALID_PASSWORD, actorId))
                    .thenReturn("cognito-sub-123");

            AppUser saved = service.register(
                    new UserAdminService.RegistrationIdentity(null, null, "new-user@synthetic.crewsafe.invalid",
                            VALID_PASSWORD),
                    "Someone", Role.WORKER, Set.of(siteId), actorId);

            assertThat(saved.getCognitoSub()).isEqualTo("cognito-sub-123");
            assertThat(saved.getEmail()).isEqualTo("new-user@synthetic.crewsafe.invalid");
            assertThat(saved.getUsername()).isEqualTo("new-user@synthetic.crewsafe.invalid");
            verify(memberships).save(any(SiteMembership.class));
            verify(audit).recordEvent(eq(actorId), eq("USER_REGISTERED"), eq("USER"), eq(saved.getId()), anyString());
        }

        @Test
        @DisplayName("A client-supplied username on the email path is ignored — the email wins")
        void emailPathIgnoresSuppliedUsername() {
            when(cognitoProvisioning.createUser("someone@synthetic.crewsafe.invalid", VALID_PASSWORD, actorId))
                    .thenReturn("cognito-sub-456");

            AppUser saved = service.register(
                    new UserAdminService.RegistrationIdentity("some-other-handle", null,
                            "someone@synthetic.crewsafe.invalid", VALID_PASSWORD),
                    "Someone", Role.WORKER, Set.of(), actorId);

            assertThat(saved.getUsername()).isEqualTo("someone@synthetic.crewsafe.invalid");
        }

        @Test
        @DisplayName("Re-inviting an already-registered email → ConflictException with USERNAME_ALREADY_REGISTERED, Cognito never called")
        void duplicateEmailAsUsername() {
            when(users.existsByUsername("someone@synthetic.crewsafe.invalid")).thenReturn(true);

            assertThatThrownBy(() -> service.register(
                    new UserAdminService.RegistrationIdentity(null, null, "someone@synthetic.crewsafe.invalid",
                            VALID_PASSWORD),
                    "Someone", Role.WORKER, Set.of(), actorId))
                    .isInstanceOf(ConflictException.class)
                    .satisfies(e -> assertThat(((ConflictException) e).getCode())
                            .isEqualTo(ErrorCode.USERNAME_ALREADY_REGISTERED));

            verify(cognitoProvisioning, never()).createUser(any(), any(), any());
            verify(users, never()).save(any());
        }
    }

    @Nested
    @DisplayName("updateRoleAndStatus")
    class UpdateRoleAndStatus {

        @Test
        @DisplayName("An admin changing their own role/status → BadRequestException")
        void cannotChangeSelf() {
            assertThatThrownBy(() -> service.updateRoleAndStatus(actorId, Role.ADMIN, null, actorId))
                    .isInstanceOf(BadRequestException.class);

            verify(users, never()).findById(any());
        }

        @Test
        @DisplayName("Unknown user → ResourceNotFoundException")
        void unknownUser() {
            UUID userId = UUID.randomUUID();
            when(users.findById(userId)).thenReturn(Optional.empty());

            assertThatThrownBy(() -> service.updateRoleAndStatus(userId, Role.SUPERVISOR, null, actorId))
                    .isInstanceOf(ResourceNotFoundException.class);
        }

        @Test
        @DisplayName("Role change is applied and audited")
        void changesRole() {
            AppUser target = user(Role.WORKER);
            when(users.findById(target.getId())).thenReturn(Optional.of(target));

            AppUser saved = service.updateRoleAndStatus(target.getId(), Role.SUPERVISOR, null, actorId);

            assertThat(saved.getRole()).isEqualTo(Role.SUPERVISOR);
            verify(audit).recordEvent(eq(actorId), eq("USER_ROLE_CHANGED"), eq("USER"), eq(target.getId()), anyString());
            verify(audit, never()).recordEvent(eq(actorId), eq("USER_STATUS_CHANGED"), any(), any(), anyString());
        }

        @Test
        @DisplayName("Status change is applied and audited")
        void changesStatus() {
            AppUser target = user(Role.WORKER);
            when(users.findById(target.getId())).thenReturn(Optional.of(target));

            AppUser saved = service.updateRoleAndStatus(target.getId(), null, UserStatus.INACTIVE, actorId);

            assertThat(saved.getStatus()).isEqualTo(UserStatus.INACTIVE);
            verify(audit).recordEvent(eq(actorId), eq("USER_STATUS_CHANGED"), eq("USER"), eq(target.getId()),
                    anyString());
        }

        @Test
        @DisplayName("Same value as current is a no-op audit-wise")
        void unchangedFieldsNotAudited() {
            AppUser target = user(Role.WORKER);
            when(users.findById(target.getId())).thenReturn(Optional.of(target));

            service.updateRoleAndStatus(target.getId(), Role.WORKER, UserStatus.ACTIVE, actorId);

            verify(audit, never()).recordEvent(any(), anyString(), anyString(), any(), anyString());
        }
    }

    @Nested
    @DisplayName("grantSite / revokeSite")
    class SiteMemberships {

        @Test
        @DisplayName("Granting an already-held site → ConflictException")
        void grantDuplicate() {
            UUID userId = UUID.randomUUID();
            UUID siteId = UUID.randomUUID();
            when(users.existsById(userId)).thenReturn(true);
            when(sites.existsById(siteId)).thenReturn(true);
            when(memberships.existsByUserIdAndSiteId(userId, siteId)).thenReturn(true);

            assertThatThrownBy(() -> service.grantSite(userId, siteId, actorId))
                    .isInstanceOf(ConflictException.class);

            verify(memberships, never()).save(any());
        }

        @Test
        @DisplayName("Granting a new site saves the membership and audits")
        void grantsAndAudits() {
            UUID userId = UUID.randomUUID();
            UUID siteId = UUID.randomUUID();
            when(users.existsById(userId)).thenReturn(true);
            when(sites.existsById(siteId)).thenReturn(true);
            when(memberships.existsByUserIdAndSiteId(userId, siteId)).thenReturn(false);

            service.grantSite(userId, siteId, actorId);

            verify(memberships).save(any(SiteMembership.class));
            verify(audit).recordEvent(eq(actorId), eq("SITE_MEMBERSHIP_GRANTED"), eq("USER"), eq(userId), anyString());
        }

        @Test
        @DisplayName("Revoking a membership that doesn't exist → ResourceNotFoundException")
        void revokeUnknown() {
            UUID userId = UUID.randomUUID();
            UUID siteId = UUID.randomUUID();
            when(memberships.findByUserIdAndSiteId(userId, siteId)).thenReturn(Optional.empty());

            assertThatThrownBy(() -> service.revokeSite(userId, siteId, actorId))
                    .isInstanceOf(ResourceNotFoundException.class);
        }

        @Test
        @DisplayName("Revoking an existing membership deletes it and audits")
        void revokesAndAudits() {
            UUID userId = UUID.randomUUID();
            UUID siteId = UUID.randomUUID();
            SiteMembership membership = new SiteMembership(userId, siteId);
            when(memberships.findByUserIdAndSiteId(userId, siteId)).thenReturn(Optional.of(membership));

            service.revokeSite(userId, siteId, actorId);

            verify(memberships).delete(membership);
            verify(audit).recordEvent(eq(actorId), eq("SITE_MEMBERSHIP_REVOKED"), eq("USER"), eq(userId), anyString());
        }
    }
}
