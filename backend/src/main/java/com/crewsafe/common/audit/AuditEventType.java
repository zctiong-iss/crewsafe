package com.crewsafe.common.audit;

/**
 * Audit event type constants.
 *
 * String constants rather than an enum because the audit table must be able to store
 * event types written by future features without a schema change, while the types used
 * here stay checked at compile time.
 */
public final class AuditEventType {

    public static final String LOGIN_SUCCESS = "LOGIN_SUCCESS";
    public static final String LOGIN_FAILURE = "LOGIN_FAILURE";
    public static final String TOKEN_REFRESHED = "TOKEN_REFRESHED";
    public static final String ACCESS_DENIED = "ACCESS_DENIED";

    private AuditEventType() {
    }
}
