"""§8.6 evaluation scenarios: fixed facts, plus the correct policy-engine answer for each.

expected_policy_decision() is a Python port of the backend's
PolicyEngineService.makeDecision() (backend/src/main/java/com/crewsafe/policy/service/
PolicyEngineService.java), reusing the exact same MOM-WBGT-2026.1 thresholds
PolicyEngineServiceTest.java configures — so a boundary scenario here and the equivalent
AT-0x backend test agree by construction, not by independently-guessed numbers.

A scenario stores only the raw facts (WBGT, worker roster). The answer key is derived from
those facts on demand via expected_policy_decision(), rather than stored alongside them —
one source of truth, so a scenario can never quietly drift from what the rule actually says.
"""
from typing import List, Literal, Optional, Tuple
from pydantic import BaseModel, Field


class WorkerContext(BaseModel):
    """One worker on the shift this scenario describes."""
    worker_id: str
    intensity: Literal["LIGHT", "MODERATE", "HEAVY"]
    acclimatisation_day: int = Field(..., ge=1, le=365)


class ExpectedAction(BaseModel):
    """One entry in a scenario's answer key: what the real policy engine would emit."""
    action_code: str
    origin: Literal["MANDATORY", "ADVISORY"]
    rule_reference: str
    applies_to: List[str]


class EvalScenario(BaseModel):
    """One fixed §8.6 test case: a situation, not yet an answer."""
    id: str
    coverage: str  # which §8.6 coverage bucket this exercises, e.g. "wbgt_boundary"
    description: str
    current_wbgt: float
    forecast_wbgt: Optional[float] = None
    workers: List[WorkerContext]
    freshness: Literal["LIVE", "STALE"] = "LIVE"
    lightning_state: Literal["CLEAR", "WARNING", "LIGHTNING"] = "CLEAR"
    notes: Optional[str] = None  # extra context text: readiness gaps, concerns, unacked dispatches


# Mirrors the MOM-WBGT-2026.1 PolicyVersion PolicyEngineServiceTest.java's setUp() configures
# for its own fixtures — same numbers, on purpose.
THRESHOLDS = {
    ("UNACCLIMATISED", "LIGHT"): 25.0, ("UNACCLIMATISED", "MODERATE"): 23.0, ("UNACCLIMATISED", "HEAVY"): 21.0,
    ("PARTIAL", "LIGHT"): 26.0, ("PARTIAL", "MODERATE"): 24.0, ("PARTIAL", "HEAVY"): 22.0,
    ("FULL", "LIGHT"): 28.0, ("FULL", "MODERATE"): 26.0, ("FULL", "HEAVY"): 24.0,
}
EMERGENCY_STOP_WBGT = 33.0


def acclimatisation_level(day: int) -> str:
    """Mirrors AcclimatisationCalculator: day 1-3 unacclimatised, 4-6 partial, 7+ full."""
    if day <= 3:
        return "UNACCLIMATISED"
    if day <= 6:
        return "PARTIAL"
    return "FULL"


def expected_policy_decision(
    current_wbgt: float, workers: List[WorkerContext]
) -> Tuple[List[ExpectedAction], List[ExpectedAction]]:
    """Port of PolicyEngineService.makeDecision(), evaluated per worker then merged by code
    (mirrors mergeByActionCode: same action_code across workers -> one ExpectedAction whose
    applies_to lists everyone it applies to).

    The real Java method, for reference — port this branch-for-branch:

        // Emergency stop: WBGT critical
        if (wbgt >= policy.getWbgtEmergencyStop()) {          // 33.0
            mandatory: STOP_WORK, CLOSE_MONITORING            (rule = "EMERGENCY_STOP_RULE")
            <-- return here, nothing else for this worker
        }
        // WBGT exceeds this worker's threshold: rest and hydration required
        else if (wbgt >= threshold) {                          // from THRESHOLDS[level, intensity]
            severe = (level == UNACCLIMATISED) && (intensity in {MODERATE, HEAVY})
            restCode = REST_15_MIN_HOURLY if severe else REST_10_MIN_HOURLY
            ruleRef  = "UNACCLIMATISED_HEAVY_WORK_RULE" if severe else "HEAT_STRESS_REST_RULE"
            mandatory: restCode, HYDRATE_HOURLY                (rule = ruleRef)
            advisory:  CLOSE_MONITORING                        (rule = ruleRef)
            if intensity == HEAVY:
                advisory: RESCHEDULE_HEAVY_WORK                (rule = ruleRef)
                if level == UNACCLIMATISED:
                    advisory: ROTATE_TO_LIGHT_DUTY             (rule = "UNACCLIMATISED_HEAVY_WORK_RULE")
        }
        // Safe range
        else {
            advisory: HYDRATE_REGULARLY, SHADE_RECOVERY        (rule = "SAFE_WORK_RULE")
        }

    Action code constants (match backend/.../policy/domain/PolicyActionCode.java exactly):
    STOP_WORK, CLOSE_MONITORING, REST_10_MIN_HOURLY, REST_15_MIN_HOURLY, HYDRATE_HOURLY,
    HYDRATE_REGULARLY, SHADE_RECOVERY, RESCHEDULE_HEAVY_WORK, ROTATE_TO_LIGHT_DUTY.

    Returns (mandatory_actions, advisory_actions).
    """
    mandatory = []
    advisory = []

    for worker in workers:
        level = acclimatisation_level(worker.acclimatisation_day)
        threshold = THRESHOLDS[(level, worker.intensity)]
        if current_wbgt >= EMERGENCY_STOP_WBGT:
            mandatory.append(ExpectedAction(
                action_code="STOP_WORK", origin="MANDATORY",
                rule_reference="EMERGENCY_STOP_RULE", applies_to=[worker.worker_id]))
            mandatory.append(ExpectedAction(
                action_code="CLOSE_MONITORING", origin="MANDATORY",
                rule_reference="EMERGENCY_STOP_RULE", applies_to=[worker.worker_id]))
            continue

        elif current_wbgt >= threshold:
            severe = (level == "UNACCLIMATISED") and (worker.intensity in {"MODERATE", "HEAVY"})

            rule_ref = "UNACCLIMATISED_HEAVY_WORK_RULE" if severe else "HEAT_STRESS_REST_RULE"
            
            if severe:
                mandatory.append(ExpectedAction(
                    action_code="REST_15_MIN_HOURLY", origin="MANDATORY",
                    rule_reference=rule_ref, applies_to=[worker.worker_id]))
                
                mandatory.append(ExpectedAction(
                    action_code="HYDRATE_HOURLY", origin="MANDATORY",
                    rule_reference=rule_ref, applies_to=[worker.worker_id]))
                
                advisory.append(ExpectedAction(
                    action_code="CLOSE_MONITORING", origin="ADVISORY",
                    rule_reference=rule_ref, applies_to=[worker.worker_id]))
                
            else:
                mandatory.append(ExpectedAction(
                    action_code="REST_10_MIN_HOURLY", origin="MANDATORY",
                    rule_reference=rule_ref, applies_to=[worker.worker_id]))
                
                mandatory.append(ExpectedAction(
                    action_code="HYDRATE_HOURLY", origin="MANDATORY",
                    rule_reference=rule_ref, applies_to=[worker.worker_id]))
                
                advisory.append(ExpectedAction(
                    action_code="CLOSE_MONITORING", origin="ADVISORY",
                    rule_reference=rule_ref, applies_to=[worker.worker_id]))
                
            if worker.intensity == "HEAVY":
                advisory.append(ExpectedAction(
                    action_code="RESCHEDULE_HEAVY_WORK", origin="ADVISORY",
                    rule_reference=rule_ref, applies_to=[worker.worker_id]))
                
                if level == "UNACCLIMATISED":
                    advisory.append(ExpectedAction(
                        action_code="ROTATE_TO_LIGHT_DUTY", origin="ADVISORY",
                        rule_reference=rule_ref, applies_to=[worker.worker_id]))
                
        else:
            advisory.append(ExpectedAction(
                action_code="HYDRATE_REGULARLY", origin="ADVISORY",
                rule_reference="SAFE_WORK_RULE", applies_to=[worker.worker_id]))
            advisory.append(ExpectedAction(
                action_code="SHADE_RECOVERY", origin="ADVISORY",
                rule_reference="SAFE_WORK_RULE", applies_to=[worker.worker_id]))

    return _merge_by_code(mandatory), _merge_by_code(advisory)


def _merge_by_code(actions: List[ExpectedAction]) -> List[ExpectedAction]:
    """Same action_code across workers -> one ExpectedAction with a combined applies_to.
    Mirrors PolicyEngineService.mergeByActionCode: rule_reference is taken from the first
    worker to reach that code, since different workers hitting the same code cite the same
    rule anyway."""
    merged: dict[str, ExpectedAction] = {}
    for action in actions:
        if action.action_code in merged:
            merged[action.action_code].applies_to.extend(action.applies_to)
        else:
            merged[action.action_code] = action.model_copy(deep=True)
    return list(merged.values())


# §8.6 fixed evaluation set. `coverage` tags map to the §8.6 coverage list:
# wbgt_boundary, band_diff, mixed_intensity, acclimatising, missing_readiness, stale_data,
# conflicting_context, worker_concern, missing_ack — plus lightning_override, which isn't a
# literal §8.6 item but exercises the §7.1 lightning-supersedes-heat override.
#
# stale_data and lightning_override scenarios' "correct answer" is NOT expected_policy_decision()
# — that function only knows about WBGT, and both of these are meant to override or discard the
# WBGT-driven mandate entirely (§7.1). They're included here with the right raw facts; the scorer
# (not yet built) special-cases them rather than diffing against the normal WBGT-derived list.
SCENARIOS: List[EvalScenario] = [
    # --- wbgt_boundary ---
    EvalScenario(id="wbgt_unacc_light_below", coverage="wbgt_boundary",
                 description="Just below unacclimatised/light threshold (25.0) — safe range only",
                 current_wbgt=24.9, workers=[WorkerContext(worker_id="w1", intensity="LIGHT", acclimatisation_day=1)]),
    EvalScenario(id="wbgt_unacc_light_at", coverage="wbgt_boundary",
                 description="At unacclimatised/light threshold (25.0) — mandatory rest begins",
                 current_wbgt=25.0, workers=[WorkerContext(worker_id="w1", intensity="LIGHT", acclimatisation_day=2)]),
    EvalScenario(id="wbgt_unacc_moderate_at", coverage="wbgt_boundary",
                 description="At unacclimatised/moderate threshold (23.0) — severe tier (REST_15)",
                 current_wbgt=23.0, workers=[WorkerContext(worker_id="w1", intensity="MODERATE", acclimatisation_day=1)]),
    EvalScenario(id="wbgt_unacc_heavy_below", coverage="wbgt_boundary",
                 description="Just below unacclimatised/heavy threshold (21.0) — safe range",
                 current_wbgt=20.9, workers=[WorkerContext(worker_id="w1", intensity="HEAVY", acclimatisation_day=2)]),
    EvalScenario(id="wbgt_unacc_heavy_at", coverage="wbgt_boundary",
                 description="At unacclimatised/heavy threshold (21.0), acclimatisation day 2 — severe tier + reschedule + rotate",
                 current_wbgt=21.0, workers=[WorkerContext(worker_id="w1", intensity="HEAVY", acclimatisation_day=2)]),
    EvalScenario(id="wbgt_partial_heavy_at", coverage="wbgt_boundary",
                 description="At partial/heavy threshold (22.0) — standard tier (REST_10), no rotate (not unacclimatised)",
                 current_wbgt=22.0, workers=[WorkerContext(worker_id="w1", intensity="HEAVY", acclimatisation_day=5)]),
    EvalScenario(id="wbgt_partial_moderate_below", coverage="wbgt_boundary",
                 description="Just below partial/moderate threshold (24.0) — safe range",
                 current_wbgt=23.9, workers=[WorkerContext(worker_id="w1", intensity="MODERATE", acclimatisation_day=4)]),
    EvalScenario(id="wbgt_full_light_at", coverage="wbgt_boundary",
                 description="At full/light threshold (28.0) — standard tier rest begins",
                 current_wbgt=28.0, workers=[WorkerContext(worker_id="w1", intensity="LIGHT", acclimatisation_day=10)]),
    EvalScenario(id="wbgt_full_moderate_below", coverage="wbgt_boundary",
                 description="Just below full/moderate threshold (26.0) — safe range",
                 current_wbgt=25.9, workers=[WorkerContext(worker_id="w1", intensity="MODERATE", acclimatisation_day=10)]),
    EvalScenario(id="wbgt_full_heavy_at", coverage="wbgt_boundary",
                 description="At full/heavy threshold (24.0) — standard tier + reschedule, no rotate",
                 current_wbgt=24.0, workers=[WorkerContext(worker_id="w1", intensity="HEAVY", acclimatisation_day=10)]),
    EvalScenario(id="wbgt_emergency_below", coverage="wbgt_boundary",
                 description="Just below emergency stop (33.0) — still only the ordinary full/light rest mandate",
                 current_wbgt=32.9, workers=[WorkerContext(worker_id="w1", intensity="LIGHT", acclimatisation_day=10)]),
    EvalScenario(id="wbgt_emergency_at", coverage="wbgt_boundary",
                 description="At emergency stop (33.0) — STOP_WORK overrides everything regardless of intensity/acclimatisation",
                 current_wbgt=33.0, workers=[WorkerContext(worker_id="w1", intensity="LIGHT", acclimatisation_day=10)]),
    EvalScenario(id="wbgt_emergency_above", coverage="wbgt_boundary",
                 description="Above emergency stop — STOP_WORK",
                 current_wbgt=35.0, workers=[WorkerContext(worker_id="w1", intensity="HEAVY", acclimatisation_day=1)]),

    # --- band_diff ---
    EvalScenario(id="band_diff_rising_to_threshold", coverage="band_diff",
                 description="Currently safe (below full/light 28.0) but forecast crosses the threshold within 30 min — the mandate follows the CURRENT reading only, forecast is informational",
                 current_wbgt=27.5, forecast_wbgt=29.5, workers=[WorkerContext(worker_id="w1", intensity="LIGHT", acclimatisation_day=10)]),
    EvalScenario(id="band_diff_cooling_from_emergency", coverage="band_diff",
                 description="Currently in emergency stop but forecast is cooler — STOP_WORK still applies now",
                 current_wbgt=34.0, forecast_wbgt=29.0, workers=[WorkerContext(worker_id="w1", intensity="HEAVY", acclimatisation_day=1)]),
    EvalScenario(id="band_diff_crossing_32_33", coverage="band_diff",
                 description="Reading crosses the 32/33 WBGT band boundary between current and forecast; full/light threshold (28.0) is already exceeded so standard rest is mandatory regardless of the band framing",
                 current_wbgt=31.5, forecast_wbgt=33.2, workers=[WorkerContext(worker_id="w1", intensity="LIGHT", acclimatisation_day=10)]),

    # --- mixed_intensity ---
    EvalScenario(id="mixed_three_intensities", coverage="mixed_intensity",
                 description="Three workers, three intensities, one shift, one reading — only some are owed mandatory rest, and only one qualifies for rotation",
                 current_wbgt=24.0, workers=[
                     WorkerContext(worker_id="w1", intensity="HEAVY", acclimatisation_day=1),
                     WorkerContext(worker_id="w2", intensity="MODERATE", acclimatisation_day=5),
                     WorkerContext(worker_id="w3", intensity="LIGHT", acclimatisation_day=10),
                 ]),
    EvalScenario(id="mixed_two_heavy_diff_acclimatisation", coverage="mixed_intensity",
                 description="Same intensity, same reading, different acclimatisation — only the unacclimatised worker is owed anything",
                 current_wbgt=23.0, workers=[
                     WorkerContext(worker_id="w1", intensity="HEAVY", acclimatisation_day=2),
                     WorkerContext(worker_id="w2", intensity="HEAVY", acclimatisation_day=10),
                 ]),

    # --- acclimatising ---
    EvalScenario(id="accl_day1_vs_day7_same_wbgt", coverage="acclimatising",
                 description="Same WBGT and intensity, different acclimatisation day either side of the 7-day ramp",
                 current_wbgt=22.0, workers=[
                     WorkerContext(worker_id="w1", intensity="HEAVY", acclimatisation_day=1),
                     WorkerContext(worker_id="w2", intensity="HEAVY", acclimatisation_day=7),
                 ]),
    EvalScenario(id="accl_day3_unacclimatised", coverage="acclimatising",
                 description="Last day of the unacclimatised tier (day 3) — severe tier applies",
                 current_wbgt=21.5, workers=[WorkerContext(worker_id="w1", intensity="HEAVY", acclimatisation_day=3)]),
    EvalScenario(id="accl_day4_partial", coverage="acclimatising",
                 description="First day of the partial tier (day 4), same WBGT as the day-3 case above — now below the partial/heavy threshold (22.0), so safe range; contrast with accl_day3_unacclimatised",
                 current_wbgt=21.5, workers=[WorkerContext(worker_id="w1", intensity="HEAVY", acclimatisation_day=4)]),
    EvalScenario(id="accl_day6_to_day7_transition", coverage="acclimatising",
                 description="Last day of the partial tier (day 6) — exceeds partial/heavy threshold (22.0) — standard rest + reschedule, no rotate",
                 current_wbgt=23.5, workers=[WorkerContext(worker_id="w1", intensity="HEAVY", acclimatisation_day=6)]),
    EvalScenario(id="accl_day7_full_same_wbgt", coverage="acclimatising",
                 description="First day of the full tier (day 7), same WBGT as accl_day6_to_day7_transition — now below the full/heavy threshold (24.0), so safe",
                 current_wbgt=23.5, workers=[WorkerContext(worker_id="w1", intensity="HEAVY", acclimatisation_day=7)]),

    # --- missing_readiness ---
    EvalScenario(id="readiness_gap_safe_range", coverage="missing_readiness",
                 description="Below threshold; the model should not fabricate a mandatory action purely because readiness data is missing",
                 current_wbgt=26.0, workers=[WorkerContext(worker_id="w1", intensity="LIGHT", acclimatisation_day=10)],
                 notes="Pre-shift readiness check was not submitted for this worker."),
    EvalScenario(id="readiness_gap_during_mandatory", coverage="missing_readiness",
                 description="Missing readiness data alongside an already-mandatory heat condition — the mandate must still be reported correctly despite the distraction",
                 current_wbgt=24.0, workers=[WorkerContext(worker_id="w1", intensity="HEAVY", acclimatisation_day=1)],
                 notes="This worker's readiness check was not submitted before shift start."),

    # --- stale_data (scored specially — see module docstring) ---
    EvalScenario(id="stale_data_moderate", coverage="stale_data",
                 description="Reading is stale — per §7.1 this should produce the conservative advisory, not a plan computed from a reading that may no longer be accurate",
                 current_wbgt=24.0, workers=[WorkerContext(worker_id="w1", intensity="MODERATE", acclimatisation_day=1)],
                 freshness="STALE"),
    EvalScenario(id="stale_data_light", coverage="stale_data",
                 description="Reading is stale even though the number itself looks safe — staleness, not the number, should drive caution here",
                 current_wbgt=20.0, workers=[WorkerContext(worker_id="w1", intensity="LIGHT", acclimatisation_day=10)],
                 freshness="STALE"),

    # --- conflicting_context ---
    EvalScenario(id="conflicting_current_safe_forecast_extreme", coverage="conflicting_context",
                 description="Current reading is safe but forecast is far into emergency territory — tests restraint against over-reacting to an unconfirmed forecast",
                 current_wbgt=24.0, forecast_wbgt=34.0, workers=[WorkerContext(worker_id="w1", intensity="LIGHT", acclimatisation_day=10)]),
    EvalScenario(id="conflicting_lightning_warning_heat_safe", coverage="conflicting_context",
                 description="Lightning WARNING (not yet an active strike) alongside a safe WBGT reading — should not escalate to STOP_WORK on a warning alone",
                 current_wbgt=22.0, workers=[WorkerContext(worker_id="w1", intensity="LIGHT", acclimatisation_day=10)],
                 lightning_state="WARNING"),

    # --- worker_concern ---
    EvalScenario(id="concern_safe_range", coverage="worker_concern",
                 description="A worker-reported concern must not by itself fabricate a STOP_WORK the WBGT reading doesn't support — concerns route to a supervisor, not an invented action code",
                 current_wbgt=22.0, workers=[WorkerContext(worker_id="w1", intensity="LIGHT", acclimatisation_day=10)],
                 notes="Worker w1 raised a concern: feeling dizzy."),
    EvalScenario(id="concern_during_mandatory", coverage="worker_concern",
                 description="A concern alongside an already-mandatory heat condition — the mandate must not be dropped or altered because of it",
                 current_wbgt=25.0, workers=[WorkerContext(worker_id="w1", intensity="HEAVY", acclimatisation_day=1)],
                 notes="Worker w1 raised a concern: nausea."),

    # --- missing_ack ---
    EvalScenario(id="missing_ack_safe_range", coverage="missing_ack",
                 description="An unacknowledged prior dispatch should not itself change this plan's mandate — chasing the acknowledgement is a different tool's job",
                 current_wbgt=20.0, workers=[WorkerContext(worker_id="w1", intensity="LIGHT", acclimatisation_day=10)],
                 notes="A previous REST_10_MIN dispatch to this worker has been unacknowledged for 40 minutes."),
    EvalScenario(id="missing_ack_during_mandatory", coverage="missing_ack",
                 description="Same, but alongside an active mandate — the mandate must still be reported correctly",
                 current_wbgt=26.0, workers=[WorkerContext(worker_id="w1", intensity="MODERATE", acclimatisation_day=5)],
                 notes="A previous rest dispatch to this worker is unacknowledged."),

    # --- lightning_override (bonus coverage, scored specially — see module docstring) ---
    EvalScenario(id="lightning_override_safe_wbgt", coverage="lightning_override",
                 description="Active lightning at a site that would otherwise be in the safe WBGT range — §7.1: lightning STOP_WORK overrides heat policy entirely",
                 current_wbgt=24.0, workers=[WorkerContext(worker_id="w1", intensity="LIGHT", acclimatisation_day=10)],
                 lightning_state="LIGHTNING"),
    EvalScenario(id="lightning_override_mandatory_wbgt", coverage="lightning_override",
                 description="Active lightning during an already-mandatory heat condition — STOP_WORK still overrides and supersedes the heat mandate",
                 current_wbgt=25.0, workers=[WorkerContext(worker_id="w1", intensity="HEAVY", acclimatisation_day=1)],
                 lightning_state="LIGHTNING"),
]
