package com.crewsafe.common.error;

/**
 * The closed vocabulary of machine-readable reasons an error response may name.
 *
 * <h2>Why this exists</h2>
 *
 * {@link GlobalExceptionHandler} deliberately flattens every {@link ConflictException} to one
 * sentence, because an exception message routinely carries a SQL fragment, a class name or a
 * file path. That rule is right and stays. Its cost, before this enum, was that a client had
 * no way to tell two unrelated conflicts apart: {@code AgentDraftService} refuses a draft
 * either because the site has no usable WBGT reading or because nobody has activated a heat
 * policy for it, and both arrived at mobile as HTTP 409 with the same body. Mobile maps 409 to
 * {@code errors.conflict} — "Someone else changed this first. Reload and try again." — so a
 * supervisor was told to reload, forever, for a condition reloading cannot fix (SCRUM-289).
 *
 * <p>A code is not an exception message. Nothing here is derived from request data,
 * persistence state or a class name; each constant is a fixed string chosen in advance and
 * reviewed as part of the API surface, exactly like an HTTP status. That is what makes it safe
 * to return when the message it accompanies is not.
 *
 * <p>Adding a constant is adding public API. Clients branch on the wire name, so it may not be
 * renamed once shipped, and any client that does not recognise one must fall back to the
 * status-derived message — see {@code messageKeyFor} in mobile's {@code api/errors.ts}.
 *
 * @author Justin Chua
 * @author Jemilin Beulah
 */
public enum ErrorCode {

    /**
     * The site has no ACTIVE {@code policy_version}, so no thresholds exist to evaluate
     * against and no plan can be drafted.
     *
     * <p>Reachable on any site created through the API rather than carried over by
     * {@code V12}: {@code V9}'s seeding INSERT is commented out, so {@code V12}'s
     * carry-forward selected from an empty table. The fix is a Safety Manager activating a
     * version, which is a person's action, not a retry — hence a distinct code.
     */
    NO_ACTIVE_POLICY,

    /**
     * The site has no WBGT reading a plan could be based on: either no observation at all, or
     * one outside the 15–40°C sanity band, which is a sensor fault rather than weather.
     */
    NO_USABLE_WBGT,

    /**
     * {@code CognitoUserProvisioningService} has not yet been switched on for this
     * environment — its IAM grant and Cognito user pool config are applied by Terraform
     * separately from a code deploy. The fix is using the existing bind-an-existing-identity
     * path instead until this environment's Terraform is confirmed applied.
     */
    COGNITO_PROVISIONING_DISABLED,

    /**
     * Cognito already has an identity under this email — most likely someone already
     * registered it, through this app or directly in the Console. The fix is binding that
     * existing identity's sub rather than retrying the registration.
     */
    EMAIL_ALREADY_REGISTERED_IN_COGNITO,

    /**
     * The chosen username is already registered locally. Distinct from
     * {@link #EMAIL_ALREADY_REGISTERED_IN_COGNITO}: this is a same-app collision the admin
     * can fix by picking a different username, not a Cognito-side conflict.
     */
    USERNAME_ALREADY_REGISTERED,

    /** A worker cannot be assigned to shifts with overlapping time ranges. */
    WORKER_HAS_OVERLAPPING_SHIFT,

    /** A closed or already-ended shift is historical and cannot be changed. */
    SHIFT_NOT_EDITABLE;
}
