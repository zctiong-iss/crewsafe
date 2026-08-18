package com.crewsafe.admin.cognito;

import com.crewsafe.common.audit.AuditService;
import com.crewsafe.common.error.BadRequestException;
import com.crewsafe.common.error.ConflictException;
import com.crewsafe.common.error.ErrorCode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import software.amazon.awssdk.services.cognitoidentityprovider.CognitoIdentityProviderClient;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminCreateUserRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminCreateUserResponse;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AttributeType;
import software.amazon.awssdk.services.cognitoidentityprovider.model.MessageActionType;
import software.amazon.awssdk.services.cognitoidentityprovider.model.UserType;
import software.amazon.awssdk.services.cognitoidentityprovider.model.UsernameExistsException;

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
 * Unit tests for {@link CognitoUserProvisioningService}.
 *
 * @author Jemilin Beulah
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("CognitoUserProvisioningService")
class CognitoUserProvisioningServiceTest {

    private static final String VALID_PASSWORD = "Valid-Password-123";

    @Mock
    private CognitoIdentityProviderClient cognito;

    @Mock
    private AuditService audit;

    private CognitoAdminProperties properties;
    private CognitoUserProvisioningService service;
    private final UUID actorId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        properties = new CognitoAdminProperties();
        properties.setUserPoolId("pool-123");

        service = new CognitoUserProvisioningService(cognito, properties, audit);
    }

    private static AdminCreateUserResponse responseWithSub(String sub) {
        return AdminCreateUserResponse.builder()
                .user(UserType.builder()
                        .attributes(AttributeType.builder().name("sub").value(sub).build())
                        .build())
                .build();
    }

    @Test
    @DisplayName("No user pool id configured → ConflictException with COGNITO_PROVISIONING_DISABLED, no AWS call")
    void noPoolIdConfigured() {
        properties.setUserPoolId(null);

        assertThatThrownBy(() -> service.createUser("someone@synthetic.crewsafe.invalid", VALID_PASSWORD, actorId))
                .isInstanceOf(ConflictException.class)
                .satisfies(e -> assertThat(((ConflictException) e).getCode())
                        .isEqualTo(ErrorCode.COGNITO_PROVISIONING_DISABLED));

        verify(cognito, never()).adminCreateUser(any(AdminCreateUserRequest.class));
    }

    @Test
    @DisplayName("Blank user pool id → ConflictException with COGNITO_PROVISIONING_DISABLED")
    void blankPoolIdConfigured() {
        properties.setUserPoolId("   ");

        assertThatThrownBy(() -> service.createUser("someone@synthetic.crewsafe.invalid", VALID_PASSWORD, actorId))
                .isInstanceOf(ConflictException.class)
                .satisfies(e -> assertThat(((ConflictException) e).getCode())
                        .isEqualTo(ErrorCode.COGNITO_PROVISIONING_DISABLED));
    }

    @Test
    @DisplayName("Password fails the pool's policy → BadRequestException, no AWS call")
    void weakPasswordRejected() {
        assertThatThrownBy(() -> service.createUser("someone@synthetic.crewsafe.invalid", "short", actorId))
                .isInstanceOf(BadRequestException.class);

        verify(cognito, never()).adminCreateUser(any(AdminCreateUserRequest.class));
    }

    @Test
    @DisplayName("Cognito already has this email → ConflictException with EMAIL_ALREADY_REGISTERED_IN_COGNITO")
    void usernameAlreadyExists() {
        when(cognito.adminCreateUser(any(AdminCreateUserRequest.class)))
                .thenThrow(UsernameExistsException.builder().message("exists").build());

        assertThatThrownBy(() -> service.createUser("taken@synthetic.crewsafe.invalid", VALID_PASSWORD, actorId))
                .isInstanceOf(ConflictException.class)
                .satisfies(e -> assertThat(((ConflictException) e).getCode())
                        .isEqualTo(ErrorCode.EMAIL_ALREADY_REGISTERED_IN_COGNITO));
    }

    @Test
    @DisplayName("Happy path: sub comes from the create response, USER_INVITED audited against the identity")
    void createsAndAudits() {
        when(cognito.adminCreateUser(any(AdminCreateUserRequest.class)))
                .thenReturn(responseWithSub("11111111-1111-1111-1111-111111111111"));

        String sub = service.createUser("someone@synthetic.crewsafe.invalid", VALID_PASSWORD, actorId);

        assertThat(sub).isEqualTo("11111111-1111-1111-1111-111111111111");

        ArgumentCaptor<AdminCreateUserRequest> requestCaptor = ArgumentCaptor.forClass(AdminCreateUserRequest.class);
        verify(cognito).adminCreateUser(requestCaptor.capture());
        assertThat(requestCaptor.getValue().userPoolId()).isEqualTo("pool-123");
        assertThat(requestCaptor.getValue().username()).isEqualTo("someone@synthetic.crewsafe.invalid");
        assertThat(requestCaptor.getValue().temporaryPassword()).isEqualTo(VALID_PASSWORD);
        assertThat(requestCaptor.getValue().messageAction()).isEqualTo(MessageActionType.SUPPRESS);

        verify(audit).record(eq(actorId), eq("USER_INVITED"), eq("COGNITO_IDENTITY"),
                eq(UUID.fromString("11111111-1111-1111-1111-111111111111")), anyString());
    }
}
