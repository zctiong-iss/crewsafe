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
 * @author Justin Chua
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

    /** A shift was cancelled rather than deleted -- the row and its assignments are kept
     * as a record (SCRUM-255). */
    public static final String SHIFT_CANCELLED = "SHIFT_CANCELLED";

    /** A PLANNED shift was auto-activated by the scheduler once its start time passed
     * (SCRUM-441). System-triggered — actorId is null, the same as {@link #ACTION_LATE}. */
    public static final String SHIFT_ACTIVATED = "SHIFT_ACTIVATED";

    /** An assignment's task, intensity or acclimatisation day was corrected
     * (SCRUM-159/160-fix). Never recorded for a workerId change — that isn't possible
     * through this event's originating endpoint. */
    public static final String SHIFT_ASSIGNMENT_UPDATED = "SHIFT_ASSIGNMENT_UPDATED";

    /** A worker was taken off a shift (SCRUM-159/160-fix). */
    public static final String SHIFT_ASSIGNMENT_REMOVED = "SHIFT_ASSIGNMENT_REMOVED";

    /** A worker appended a pre-shift readiness answer (SCRUM-163). */
    public static final String READINESS_SUBMITTED = "READINESS_SUBMITTED";

    /** A supervisor sent an approved safety action to a worker (SCRUM-185). */
    public static final String ACTION_DISPATCHED = "ACTION_DISPATCHED";

    /** A worker acknowledged a dispatched safety action (SCRUM-185). */
    public static final String ACTION_ACKNOWLEDGED = "ACTION_ACKNOWLEDGED";

    /** A worker completed a dispatched safety action (SCRUM-185). */
    public static final String ACTION_COMPLETED = "ACTION_COMPLETED";

    /** A dispatched action passed its ack-window unacknowledged; the sweep flipped it to
     * LATE rather than a worker action (SCRUM-324). */
    public static final String ACTION_LATE = "ACTION_LATE";

    /** An acknowledged action passed its auto-complete window with no worker complete tap,
     * so the sweep completed it instead (SCRUM-324). */
    public static final String ACTION_AUTO_COMPLETED = "ACTION_AUTO_COMPLETED";

    /**
     * The agent drafted a recommendation for a shift (SCRUM-289). Recorded for every draft,
     * including ones the language model never touched — the detail carries which model wrote
     * it and whether the deterministic fallback produced it, so the audit trail distinguishes
     * "the model said this" from "the model was unavailable and the policy engine said this".
     */
    public static final String RECOMMENDATION_DRAFTED = "RECOMMENDATION_DRAFTED";

    /** A supervisor approved an AI-drafted recommendation as-is (SCRUM-119). */
    public static final String RECOMMENDATION_APPROVED = "RECOMMENDATION_APPROVED";

    /** A supervisor rejected an AI-drafted recommendation (SCRUM-119). */
    public static final String RECOMMENDATION_REJECTED = "RECOMMENDATION_REJECTED";

    /** A supervisor approved an AI-drafted recommendation with changes (SCRUM-119). The
     * original draft is retained on the recommendation; the edited version is retained on
     * the resulting approval. */
    public static final String RECOMMENDATION_EDITED = "RECOMMENDATION_EDITED";

    /** An open PENDING_APPROVAL recommendation was replaced by a new auto-triggered draft for
     * the same shift before a supervisor decided on it (SCRUM-291). System-triggered --
     * actorId is null, the same as {@link #SHIFT_ACTIVATED}. */
    public static final String RECOMMENDATION_SUPERSEDED = "RECOMMENDATION_SUPERSEDED";

    /** A lightning-immediate or WBGT-max stop-work recommendation skipped supervisor approval
     * and was dispatched straight to workers (SCRUM-440). Recorded once per recommendation,
     * alongside one {@link #ACTION_AUTO_DISPATCHED} per worker/action actually dispatched.
     * System-triggered -- actorId is null. */
    public static final String RECOMMENDATION_AUTO_DISPATCHED = "RECOMMENDATION_AUTO_DISPATCHED";

    /** A worker-level dispatch created by the SCRUM-440 auto-dispatch path rather than a
     * supervisor's {@code POST /api/action-dispatch} (which records {@link #ACTION_DISPATCHED}
     * instead). System-triggered -- actorId is null. */
    public static final String ACTION_AUTO_DISPATCHED = "ACTION_AUTO_DISPATCHED";

    /** A worker logged a rest or a drink of water (US-11). */
    public static final String WELLBEING_LOGGED = "WELLBEING_LOGGED";

    /** A worker reported that they are struggling (US-11). */
    public static final String CONCERN_RAISED = "CONCERN_RAISED";

    /** A supervisor confirmed they have seen a worker's concern (US-11). */
    public static final String CONCERN_ACKNOWLEDGED = "CONCERN_ACKNOWLEDGED";

    /** A Safety Manager configured a new heat policy version for a site (SCRUM-120). Recorded
     * whether the version was created as a DRAFT or auto-activated as the site's first version. */
    public static final String POLICY_VERSION_CREATED = "POLICY_VERSION_CREATED";

    /** A Safety Manager activated a heat policy version, superseding whichever version was
     * previously active for that site (SCRUM-120). */
    public static final String POLICY_VERSION_ACTIVATED = "POLICY_VERSION_ACTIVATED";

    private AuditEventType() {
    }
}
