package com.crewsafe.identity.domain;

/**
 * The four CrewSafe roles.
 *
 * Stored without a {@code ROLE_} prefix. The prefix is Spring Security's convention for
 * authority strings, not a property of the domain, so it is applied when building
 * authorities rather than persisted — see {@code CrewSafeUserPrincipal#getAuthorities}.
 */
public enum Role {

    /** Outdoor worker. Mobile app only. Sees their own shift and dispatched actions. */
    WORKER,

    /** Crew supervisor. Approves plans and monitors their assigned sites. */
    SUPERVISOR,

    /** Workplace safety manager. Policy configuration, reporting and audit across sites. */
    SAFETY_MANAGER,

    /** System administrator. Users, roles, sites and integrations. */
    ADMIN
}
