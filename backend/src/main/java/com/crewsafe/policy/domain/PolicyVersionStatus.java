package com.crewsafe.policy.domain;

/**
 * Lifecycle state of a {@link PolicyVersion} (SCRUM-120).
 *
 * @author Jemilin Beulah
 */
public enum PolicyVersionStatus {

    /** Configured but not yet governing recommendations for its site. */
    DRAFT,

    /** The version currently in force. At most one per site — enforced by
     * {@code uq_policy_version_active_per_site} (V12), not just application logic. */
    ACTIVE,

    /** Was ACTIVE, replaced by a later activation. Terminal — never reactivated. */
    SUPERSEDED
}
