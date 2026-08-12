package com.crewsafe.policy.domain;

/**
 * Work intensity level used to select a WBGT threshold from a {@link PolicyVersion}.
 *
 * <p>Top-level rather than nested in {@link PolicyVersion} (it was previously nested in the
 * entity it replaced, {@code HeatRestPolicy}) because it is a value {@link
 * com.crewsafe.policy.service.PolicyEngineService} accepts as a parameter independent of any
 * particular policy version, not a detail of the entity's storage shape.
 *
 * @author Jemilin Beulah
 */
public enum WorkIntensity {
    LIGHT,
    MODERATE,
    HEAVY
}
