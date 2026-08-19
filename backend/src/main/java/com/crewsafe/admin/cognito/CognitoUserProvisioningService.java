package com.crewsafe.admin.cognito;

import com.crewsafe.common.audit.AuditEventType;
import com.crewsafe.common.audit.AuditService;
import com.crewsafe.common.error.BadRequestException;
import com.crewsafe.common.error.ConflictException;
import com.crewsafe.common.error.ErrorCode;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.services.cognitoidentityprovider.CognitoIdentityProviderClient;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminCreateUserRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminCreateUserResponse;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AttributeType;
import software.amazon.awssdk.services.cognitoidentityprovider.model.InvalidPasswordException;
import software.amazon.awssdk.services.cognitoidentityprovider.model.MessageActionType;
import software.amazon.awssdk.services.cognitoidentityprovider.model.UsernameExistsException;

import java.util.UUID;
import java.util.regex.Pattern;

/**
 * The one place this codebase calls Cognito's admin API. Provisions a brand-new Cognito
 * identity for {@code POST /api/v1/admin/users} — see {@code UserAdminService.register}'s
 * javadoc for how the resulting {@code sub} is used from there.
 *
 * <p>The admin sets the password directly (ADR 0018 supersedes ADR 0004's "backend never
 * sees a password" on this one path, deliberately): {@code MessageAction=SUPPRESS} and an
 * explicit {@code TemporaryPassword}, not Cognito's auto-generate-and-email flow. This
 * project's accounts are seeded under the reserved {@code @synthetic.crewsafe.invalid}
 * domain, which cannot receive real mail — an emailed invite would be undeliverable by
 * design, so it was never a workable path here.
 *
 * @author Jemilin Beulah
 */
@Service
@RequiredArgsConstructor
public class CognitoUserProvisioningService {

    /** Mirrors the live pool's password_policy (infra/terraform/cognito/main.tf): 12+ chars,
     * at least one upper, one lower, one digit, one non-alphanumeric. Checked here so a weak
     * password fails with a clear 400 instead of a raw Cognito InvalidPasswordException. */
    private static final Pattern PASSWORD_POLICY = Pattern.compile(
            "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^A-Za-z0-9]).{12,}$");

    private final CognitoIdentityProviderClient cognito;
    private final CognitoAdminProperties properties;
    private final AuditService audit;

    /**
     * @throws ConflictException with {@link ErrorCode#COGNITO_PROVISIONING_DISABLED} if this
     *                            environment's Terraform (IAM grant, user pool id) hasn't
     *                            been applied yet
     * @throws BadRequestException if the password doesn't meet the pool's policy
     * @throws ConflictException with {@link ErrorCode#EMAIL_ALREADY_REGISTERED_IN_COGNITO}
     *                            if Cognito already has an identity under this email
     */
    public String createUser(String email, String password, UUID actorId) {
        if (properties.getUserPoolId() == null || properties.getUserPoolId().isBlank()) {
            throw new ConflictException(
                    "Cognito provisioning is not enabled in this environment", ErrorCode.COGNITO_PROVISIONING_DISABLED);
        }
        if (password == null || !PASSWORD_POLICY.matcher(password).matches()) {
            throw new BadRequestException("Password does not meet the pool's password policy");
        }

        AdminCreateUserResponse response;
        try {
            response = cognito.adminCreateUser(AdminCreateUserRequest.builder()
                    .userPoolId(properties.getUserPoolId())
                    .username(email)
                    .userAttributes(
                            AttributeType.builder().name("email").value(email).build(),
                            AttributeType.builder().name("email_verified").value("true").build())
                    .temporaryPassword(password)
                    .messageAction(MessageActionType.SUPPRESS)
                    .build());
        } catch (UsernameExistsException e) {
            throw new ConflictException(
                    "Cognito already has an identity for " + email, ErrorCode.EMAIL_ALREADY_REGISTERED_IN_COGNITO);
        } catch (InvalidPasswordException e) {
            throw new BadRequestException("Cognito rejected the password: " + e.getMessage());
        }

        String sub = response.user().attributes().stream()
                .filter(attribute -> "sub".equals(attribute.name()))
                .findFirst()
                .map(AttributeType::value)
                .orElseThrow(() -> new IllegalStateException("AdminCreateUser response carried no sub"));

        // Targets the Cognito identity itself, not a local app_user row -- none exists yet
        // at this point in the call.
        audit.recordEvent(actorId, AuditEventType.USER_INVITED, "COGNITO_IDENTITY", UUID.fromString(sub),
                "Invited " + email);

        return sub;
    }
}
