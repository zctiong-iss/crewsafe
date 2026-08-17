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
 * {@code enabled} and a non-blank {@code userPoolId} itself and fails one request cleanly
 * (409) rather than the app failing to boot.
 *
 * @author Jemilin Beulah
 */
@ConfigurationProperties(prefix = "app.cognito-admin")
@Getter
@Setter
public class CognitoAdminProperties {

    /** Off by default — flip only once the Terraform in infra/terraform/secrets (IAM grant)
     * and infra/terraform/compute (env var) are applied and confirmed live. */
    private boolean enabled = false;

    /** The pool {@code AdminCreateUser} targets. Not set until the Terraform above publishes
     * it — null/blank is treated the same as {@code enabled=false}. */
    private String userPoolId;
}
