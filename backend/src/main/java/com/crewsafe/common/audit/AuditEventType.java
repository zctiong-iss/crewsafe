package com.crewsafe.common.audit;

/**
 * Controlled vocabulary for audit event types.
 *
 * String constants rather than an enum because the audit table must be able to store
 * event types written by future features without a schema change, while the types used
 * here stay checked at compile time. New values use uppercase snake case and describe an
 * event that already happened, for example {@code SHIFT_CLOSED}; callers must add the
 * constant here before writing the new event type.
 *
 * @author Jemilin Beulah
 */
public final class AuditEventType {

    /**
     * The first authenticated API call seen for a given access token. Cognito owns the
     * actual credential check (Hosted UI), which happens off our infrastructure, so this is
     * the closest the backend can observe to "a user logged in" - see
     * {@link com.crewsafe.identity.security.CognitoJwtAuthenticationConverter}.
     *
     * <p>Deliberately <em>not</em> called {@code LOGIN_SUCCESS}: access tokens are short
     * lived (15 minutes for the web client), so one working day of silent token refresh
     * produces roughly thirty of these rows for a single human login. Anyone reading this
     * table must count tokens, not logins.
     */
    public static final String TOKEN_FIRST_SEEN = "TOKEN_FIRST_SEEN";

    /** An authenticated user attempted to access a site outside their membership. */
    public static final String ACCESS_DENIED = "ACCESS_DENIED";

    /** A shift was created (SCRUM-160). Recorded once per successful create, regardless of
     * how many assignments were given at creation time. */
    public static final String SHIFT_CREATED = "SHIFT_CREATED";

    /** A shift's startsAt/endsAt was corrected (SCRUM-159/160-fix). Not used for a status
     * transition — status has no correction path yet. */
    public static final String SHIFT_UPDATED = "SHIFT_UPDATED";

    /** A shift and all of its assignments were removed (SCRUM-159/160-fix). */
    public static final String SHIFT_DELETED = "SHIFT_DELETED";

    /** An assignment's task, intensity or acclimatisation day was corrected
     * (SCRUM-159/160-fix). Never recorded for a workerId change — that isn't possible
     * through this event's originating endpoint. */
    public static final String SHIFT_ASSIGNMENT_UPDATED = "SHIFT_ASSIGNMENT_UPDATED";

    /** A worker was taken off a shift (SCRUM-159/160-fix). */
    public static final String SHIFT_ASSIGNMENT_REMOVED = "SHIFT_ASSIGNMENT_REMOVED";

    /** A supervisor sent an approved safety action to a worker (SCRUM-185). */
    public static final String ACTION_DISPATCHED = "ACTION_DISPATCHED";

    /** A worker acknowledged a dispatched safety action (SCRUM-185). */
    public static final String ACTION_ACKNOWLEDGED = "ACTION_ACKNOWLEDGED";

    /** A worker completed a dispatched safety action (SCRUM-185). */
    public static final String ACTION_COMPLETED = "ACTION_COMPLETED";

    private AuditEventType() {
    }
}
