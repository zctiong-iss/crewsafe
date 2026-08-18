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

    /** A shift was manually closed once it had naturally ended (SCRUM-442). Distinct from
     * {@link #SHIFT_CANCELLED}: a closed shift ran; a cancelled one didn't. */
    public static final String SHIFT_CLOSED = "SHIFT_CLOSED";

    /** A PLANNED shift was auto-activated by the scheduler once its start time passed
     * (SCRUM-441). System-triggered — actorId is null, the same as {@link #ACTION_LATE}. */
    public static final String SHIFT_ACTIVATED = "SHIFT_ACTIVATED";

    /**
     * A worker was put on a shift (SCRUM-452), whether at shift creation or added to an
     * existing shift afterwards. One per assignment, so a shift created with three workers
     * writes one {@link #SHIFT_CREATED} and three of these.
     *
     * <p>Added late: the trail recorded {@link #SHIFT_ASSIGNMENT_UPDATED} and
     * {@link #SHIFT_ASSIGNMENT_REMOVED} from the start but never the original assignment,
     * so it could show a worker being taken off a shift or having their intensity corrected
     * while staying silent on who put them there. "Who assigned this worker to heavy work on
     * acclimatisation day 2" is the first thing an inspector asks, so the detail carries the
     * intensity and acclimatisation state, not just the ids.
     */
    public static final String SHIFT_ASSIGNMENT_ADDED = "SHIFT_ASSIGNMENT_ADDED";

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

    /** A lightning-immediate stop-work recommendation skipped supervisor approval and was
     * dispatched straight to workers (SCRUM-440). Recorded once per recommendation,
     * alongside one {@link #ACTION_AUTO_DISPATCHED} per worker/action actually dispatched.
     * System-triggered -- actorId is null. */
    public static final String RECOMMENDATION_AUTO_DISPATCHED = "RECOMMENDATION_AUTO_DISPATCHED";

    /** A worker-level dispatch created by the SCRUM-440 auto-dispatch path rather than a
     * supervisor's {@code POST /api/action-dispatch} (which records {@link #ACTION_DISPATCHED}
     * instead). System-triggered -- actorId is null. */
    public static final String ACTION_AUTO_DISPATCHED = "ACTION_AUTO_DISPATCHED";

    /** A not-yet-acknowledged dispatch was cancelled because the recommendation it came from
     * was superseded by a new auto-triggered draft (SCRUM-291's supersede reaching {@code
     * APPROVED}/{@code AUTO_DISPATCHED} plans). System-triggered -- actorId is null, the same
     * as {@link #RECOMMENDATION_SUPERSEDED}. */
    public static final String ACTION_REVOKED = "ACTION_REVOKED";

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

    /** An admin created a new site. */
    public static final String SITE_CREATED = "SITE_CREATED";

    /** An admin updated a site's name or coordinates. */
    public static final String SITE_UPDATED = "SITE_UPDATED";

    /** An admin archived a site — soft-removed, not deleted; the row and its history stay. */
    public static final String SITE_ARCHIVED = "SITE_ARCHIVED";

    /** An admin unarchived a previously archived site. */
    public static final String SITE_UNARCHIVED = "SITE_UNARCHIVED";

    /** An admin registered a local {@code app_user} row — either bound to a Cognito identity
     * that already existed (Console, or the SCRUM-190 CI pipeline), or one just provisioned
     * by {@link #USER_INVITED}. Recorded once per registration regardless of which path
     * produced the {@code cognitoSub}. */
    public static final String USER_REGISTERED = "USER_REGISTERED";

    /** An admin invited a brand-new person: the backend called Cognito's
     * {@code AdminCreateUser} directly and Cognito emailed a temporary password. Recorded by
     * {@code CognitoUserProvisioningService} against the new Cognito identity itself
     * ({@code targetType="COGNITO_IDENTITY"}) rather than the local {@code app_user} row,
     * which does not exist yet at that point — this is also what the daily invite quota
     * counts, so it stays accurate even if the subsequent local registration fails. */
    public static final String USER_INVITED = "USER_INVITED";

    /** An admin changed a user's role. */
    public static final String USER_ROLE_CHANGED = "USER_ROLE_CHANGED";

    /** An admin activated or deactivated a user. */
    public static final String USER_STATUS_CHANGED = "USER_STATUS_CHANGED";

    /** An admin granted a user access to a site. */
    public static final String SITE_MEMBERSHIP_GRANTED = "SITE_MEMBERSHIP_GRANTED";

    /** An admin revoked a user's access to a site. */
    public static final String SITE_MEMBERSHIP_REVOKED = "SITE_MEMBERSHIP_REVOKED";

    /**
     * A Safety Manager or Admin exported a site's audit timeline (SCRUM-435/SCRUM-452).
     * Targets the SITE, and the detail carries the range and row count.
     *
     * <p>Pulling the evidence is itself an event worth having evidence of: this is the one
     * endpoint that reads the whole trail out of the system, and an audit trail that cannot
     * say who took a copy of it has a hole in exactly the place an inspector would look.
     */
    public static final String AUDIT_EXPORTED = "AUDIT_EXPORTED";

    private AuditEventType() {
    }
}
