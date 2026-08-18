package com.crewsafe.admin.cognito;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Binds {@code app.cognito-admin.*}.
 *
 * Deliberately not {@code @Validated}/{@code @NotBlank}: the Terraform that publishes
 * {@code userPoolId} and grants the IAM permission {@link CognitoUserProvisioningService}
 * needs is applied separately from a code deploy, so requiring this at startup would crash
 * the whole application during that window. {@link CognitoUserProvisioningService} checks
 * for a non-blank {@code userPoolId} itself and fails one request cleanly (409) rather than
 * the app failing to boot.
 *
 * <p>There is deliberately no separate {@code enabled} toggle: the pool id is already the
 * one signal that matters. It comes straight from the live Cognito pool
 * ({@code local.cognito.user_pool_id} in {@code infra/terraform/secrets/main.tf}) — blank
 * until that Terraform is applied, a real id once it is — so a second, manually-flipped flag
 * would only duplicate that signal and add a step someone can forget to flip.
 *
 * @author Jemilin Beulah
 */
@ConfigurationProperties(prefix = "app.cognito-admin")
@Getter
@Setter
public class CognitoAdminProperties {

    /** The pool {@code AdminCreateUser} targets. Not set until the Terraform above publishes
     * it — null/blank means provisioning isn't available yet. */
    private String userPoolId;
}
