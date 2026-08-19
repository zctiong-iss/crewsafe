package com.crewsafe.mitigation.domain;

import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * The action codes a recommendation may carry, and what each becomes when dispatched to a
 * worker (SCRUM-119, implementing the allowlist agreed in the SCRUM-118 design).
 *
 * <p><strong>Why an allowlist rather than free text.</strong> The mobile app renders a dispatched
 * action as {@code t("actions." + actionCode)} against {@code mobile/src/localization/*.json},
 * which ships an {@code actions.*} block of exactly these keys in all seven locales. A code that
 * is not in that block falls through to {@code humaniseActionCode()}, which renders humanised
 * <em>English</em> to a worker who may not read English. That is the failure FR-26c and SCRUM-205
 * exist to prevent, so "the code is in this set" is a safety property, not a tidiness one.
 *
 * <p><strong>Why two catalogues.</strong> A recommendation describes a standing instruction — rest
 * fifteen minutes <em>every hour</em> — while a dispatch is one thing to do now, with recurrence
 * carried separately. The recurring forms therefore map to their one-shot equivalents on the way
 * out. This also keeps the mobile rest timer honest: it recovers a duration from the code with
 * {@code REST_(\d+)_MIN} (SCRUM-206), and handing it {@code REST_15_MIN_HOURLY} would leave it
 * matching a prefix and silently dropping the recurrence.
 *
 * <p>Deliberately absent: any lightning instruction. §7.1 requires workers be told to seek proper
 * <em>shelter</em>, and the nearest translated string here is {@code SEEK_SHADE} — shade is not
 * shelter from lightning. That instruction already reaches workers as banner copy
 * ({@code lightning.stopWorkBody}, translated in all seven locales) and must not be approximated
 * by an action code.
 *
 * @author Justin Chua
 */
public final class ActionCatalogue {

    private ActionCatalogue() {
    }

    private static final String STOP_WORK = "STOP_WORK";
    private static final String HYDRATION = "HYDRATION";
    private static final String HYDRATE = "HYDRATE";

    /**
     * Every code a mitigation may carry, mapped to the topic a client groups it under.
     *
     * <p>Both halves of the catalogue are here — the recurring recommendation forms and the
     * one-shot dispatch forms — because a supervisor's edited plan is validated against this same
     * set, and an edit that narrowed a recurring action to its one-shot form is a legitimate
     * thing for them to have done.
     */
    private static final Map<String, String> CATEGORY_BY_CODE = Map.ofEntries(
            Map.entry(STOP_WORK, STOP_WORK),
            Map.entry("RESUME_WORK", STOP_WORK),
            Map.entry("REST_10_MIN_HOURLY", "REST"),
            Map.entry("REST_15_MIN_HOURLY", "REST"),
            Map.entry("REST_10_MIN", "REST"),
            Map.entry("REST_15_MIN", "REST"),
            Map.entry("HYDRATE_HOURLY", HYDRATION),
            Map.entry("HYDRATE_REGULARLY", HYDRATION),
            Map.entry(HYDRATE, HYDRATION),
            Map.entry("SHADE_RECOVERY", "SHADE_COOLING"),
            Map.entry("SEEK_SHADE", "SHADE_COOLING"),
            Map.entry("RESCHEDULE_HEAVY_WORK", "WORK_SCHEDULING"),
            Map.entry("ROTATE_TO_LIGHT_DUTY", "WORK_SCHEDULING"),
            Map.entry("CLOSE_MONITORING", "MONITORING"));

    /**
     * Recommendation code to the dispatch code a worker's device receives.
     *
     * <p>Only the recurring forms appear. Everything else dispatches as itself, so a code added
     * to the catalogue is dispatchable the moment it is translated, without a second edit here.
     */
    private static final Map<String, String> DISPATCH_CODE_BY_CODE = Map.of(
            "REST_10_MIN_HOURLY", "REST_10_MIN",
            "REST_15_MIN_HOURLY", "REST_15_MIN",
            "HYDRATE_HOURLY", HYDRATE,
            "HYDRATE_REGULARLY", HYDRATE,
            "SHADE_RECOVERY", "SEEK_SHADE");

    public static boolean isKnown(String actionCode) {
        return actionCode != null && CATEGORY_BY_CODE.containsKey(actionCode);
    }

    public static Set<String> knownCodes() {
        return CATEGORY_BY_CODE.keySet();
    }

    /** Empty for a code outside the catalogue — callers decide whether that is a 400 or a skip. */
    public static Optional<String> categoryOf(String actionCode) {
        return Optional.ofNullable(CATEGORY_BY_CODE.get(actionCode));
    }

    /**
     * What this code becomes on the way to a worker. Identity for anything without a recurring
     * form; empty for a code outside the catalogue, so an unknown code can never be dispatched.
     */
    public static Optional<String> toDispatchCode(String actionCode) {
        if (!isKnown(actionCode)) {
            return Optional.empty();
        }
        return Optional.of(DISPATCH_CODE_BY_CODE.getOrDefault(actionCode, actionCode));
    }
}
