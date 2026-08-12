package com.crewsafe.policy.domain;

/**
 * Controlled vocabulary for {@link PolicyDecision.PolicyAction#code()}.
 *
 * String constants rather than an enum, matching {@code AuditEventType}'s reasoning: the
 * agent (SCRUM-118) validates a drafted plan's action codes against an allowlist before it
 * can be saved, and that allowlist needs to be extensible without a schema or enum change
 * while everything defined here stays checked at compile time.
 *
 * <p>Every constant here has a translated string in {@code mobile/src/localization/*.json}
 * under {@code actions.*}, in all seven shipped locales — checked against the app, not
 * assumed. An action code with no translated string renders humanised English to a worker
 * who may not read English, so this list is deliberately restricted to what the app can
 * already display. {@code ACCLIMATISATION_RESTRICT} and the {@code FASTING_*} codes are
 * reserved for later features and intentionally not defined here yet — adding one requires
 * writing and translating the string first, not just adding a constant.
 */
public final class PolicyActionCode {

    /** Lightning or emergency-heat stop. Mobile's {@code lightning.stopWorkBody} string
     * already carries the "seek proper shelter" instruction outside this action-code
     * system, so there is no separate shelter code — see the SCRUM-118 design doc. */
    public static final String STOP_WORK = "STOP_WORK";

    /** Paired with a prior {@code STOP_WORK} once a supervisor confirms it is safe. */
    public static final String RESUME_WORK = "RESUME_WORK";

    /** Ten-minute continuous rest, once per hour. */
    public static final String REST_10_MIN_HOURLY = "REST_10_MIN_HOURLY";

    /** Fifteen-minute continuous rest, once per hour — the more severe tier. */
    public static final String REST_15_MIN_HOURLY = "REST_15_MIN_HOURLY";

    /** Mandatory hourly hydration, paired with a rest action. */
    public static final String HYDRATE_HOURLY = "HYDRATE_HOURLY";

    /** Advisory hydration guidance below the rest threshold. */
    public static final String HYDRATE_REGULARLY = "HYDRATE_REGULARLY";

    /** Advisory: use available shade for recovery. */
    public static final String SHADE_RECOVERY = "SHADE_RECOVERY";

    /** Advisory: reschedule heavy-intensity work to a cooler part of the day. */
    public static final String RESCHEDULE_HEAVY_WORK = "RESCHEDULE_HEAVY_WORK";

    /** Advisory: move an unacclimatised worker off heavy-intensity work. */
    public static final String ROTATE_TO_LIGHT_DUTY = "ROTATE_TO_LIGHT_DUTY";

    /** Advisory or mandatory (during an emergency stop): watch this worker or crew more
     * closely for signs of heat illness. */
    public static final String CLOSE_MONITORING = "CLOSE_MONITORING";

    private PolicyActionCode() {
    }
}
