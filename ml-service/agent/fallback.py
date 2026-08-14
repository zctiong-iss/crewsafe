"""The deterministic plan: the policy decision, rendered without a model.

This is not a degraded placeholder. It is a complete, correct, approvable plan — every
mandatory action present, every citation accurate, every worker correctly targeted — that
happens to be written in fixed English instead of generated prose. What the LLM adds over
this is readability, and readability is the only thing that is ever lost when it fails.

Framing it that way is deliberate. It means the answer to "what if Bedrock is down?" is "the
supervisor gets a plainer plan", not "the safety feature is unavailable", and it means no code
path anywhere in the agent can produce *no* plan. That path will run in production: this AWS
account throttles under modest burst regardless of its token quota, so the graph reaches this
node for real, not just in tests.

Everything here is derived from `PolicyDecisionPayload`. There is no independent judgement in
this file — no thresholds, no rules, no decisions about what is required. It is a rendering,
which is why it cannot disagree with the policy engine.
"""
from typing import Dict, List, Optional

from agent.contract import PolicyActionPayload, PolicyDecisionPayload, AgentDraftRequest
from models import MitigationBatch, MitigationSuggestion, Timing

# Mirrors ActionCatalogue.CATEGORY_BY_CODE (backend), restricted to the codes the policy engine
# can actually emit. Note RESUME_WORK groups under STOP_WORK, matching the Java map — the
# category is the topic "work stoppage", not the direction of the change.
CATEGORY_BY_CODE: Dict[str, str] = {
    "STOP_WORK": "STOP_WORK",
    "RESUME_WORK": "STOP_WORK",
    "REST_10_MIN_HOURLY": "REST",
    "REST_15_MIN_HOURLY": "REST",
    "HYDRATE_HOURLY": "HYDRATION",
    "HYDRATE_REGULARLY": "HYDRATION",
    "SHADE_RECOVERY": "SHADE_COOLING",
    "RESCHEDULE_HEAVY_WORK": "WORK_SCHEDULING",
    "ROTATE_TO_LIGHT_DUTY": "WORK_SCHEDULING",
    "CLOSE_MONITORING": "MONITORING",
}

# Only codes whose recurrence is fixed by the code itself appear. A code with no inherent
# schedule gets no `timing` at all rather than an invented one — absent means "no fixed
# schedule", and a fabricated interval would look equally authoritative on screen.
TIMING_BY_CODE: Dict[str, Timing] = {
    "REST_15_MIN_HOURLY": Timing(durationMinutes=15, everyMinutes=60),
    "REST_10_MIN_HOURLY": Timing(durationMinutes=10, everyMinutes=60),
    "HYDRATE_HOURLY": Timing(everyMinutes=60),
}

# Fixed prose per code. Each string is written to stand on its own on a supervisor's screen and
# to clear the ten-character completeness floor the §8.6 explanation metric applies, so the
# fallback's own output passes the same quality bar a model's output is held to.
ACTION_TEXT: Dict[str, str] = {
    "STOP_WORK": "Stop work immediately and move the crew to a cool, shaded area",
    "RESUME_WORK": "Work may resume under normal precautions",
    "REST_10_MIN_HOURLY": "Take a 10-minute rest break in shade every hour",
    "REST_15_MIN_HOURLY": "Take a 15-minute rest break in shade every hour",
    "HYDRATE_HOURLY": "Drink water every hour, roughly one cup per break",
    "HYDRATE_REGULARLY": "Drink water regularly throughout the shift",
    "SHADE_RECOVERY": "Keep shaded recovery space available to the crew",
    "RESCHEDULE_HEAVY_WORK": "Move heavy tasks to a cooler part of the day where possible",
    "ROTATE_TO_LIGHT_DUTY": "Rotate affected workers onto lighter duties",
    "CLOSE_MONITORING": "Monitor affected workers closely for signs of heat illness",
}

IMPACT_TEXT: Dict[str, str] = {
    "STOP_WORK": "Removes heat exposure entirely while the condition persists",
    "RESUME_WORK": "Returns the crew to normal productivity under routine precautions",
    "REST_10_MIN_HOURLY": "Lowers core body temperature between work periods",
    "REST_15_MIN_HOURLY": "Substantially lowers core body temperature between work periods",
    "HYDRATE_HOURLY": "Replaces fluid lost to sweating and limits dehydration",
    "HYDRATE_REGULARLY": "Maintains hydration across the shift",
    "SHADE_RECOVERY": "Gives workers somewhere to cool down before symptoms develop",
    "RESCHEDULE_HEAVY_WORK": "Cuts metabolic heat load during the hottest hours",
    "ROTATE_TO_LIGHT_DUTY": "Reduces exposure for the workers most at risk",
    "CLOSE_MONITORING": "Catches early heat illness before it becomes an emergency",
}

# Human-readable band names for the plan-level rationale. Keys are WbgtBand's wire names.
BAND_TEXT: Dict[str, str] = {
    "BELOW_31": "below 31°C",
    "31_TO_BELOW_32": "between 31°C and 32°C",
    "32_TO_BELOW_33": "between 32°C and 33°C",
    "33_AND_ABOVE": "at or above 33°C",
}


def build_fallback_plan(request: AgentDraftRequest) -> MitigationBatch:
    """One mitigation per policy action, mandatory first so the plan reads in priority order."""
    policy = request.policyDecision
    mitigations = [_mitigation(a, "MANDATORY") for a in policy.mandatoryActions]
    mitigations.extend(_mitigation(a, "ADVISORY") for a in policy.advisoryActions)
    return MitigationBatch(mitigations=mitigations)


def build_fallback_rationale(request: AgentDraftRequest) -> str:
    """The whole-plan paragraph mobile renders above the mitigation list.

    Says what was measured, what band that puts the site in, which policy version decided, and
    how many actions that produced — the §12.2 minimum, phrased as a sentence rather than a
    field dump. When the reading is stale or lightning is nearby, that is stated first, because
    it changes how much weight a supervisor should put on the rest of the paragraph.
    """
    policy = request.policyDecision
    band = BAND_TEXT.get(policy.currentBand, policy.currentBand)
    parts: List[str] = []

    if request.freshness in ("STALE", "DELAYED"):
        parts.append(
            f"The most recent WBGT reading is {request.freshness.lower()} and may not reflect "
            "current conditions, so this plan is precautionary."
        )
    if request.lightningState == "ADVISORY":
        parts.append("Lightning has been detected near the site; work may need to stop at short notice.")

    parts.append(
        f"WBGT is {request.currentWbgt}°C, {band}, assessed against heat policy "
        f"{policy.policyVersion}."
    )

    n_mandatory = len(policy.mandatoryActions)
    n_advisory = len(policy.advisoryActions)
    if n_mandatory:
        parts.append(
            f"{n_mandatory} control{_s(n_mandatory)} {_is(n_mandatory)} required for "
            f"{len(request.workers)} worker{_s(len(request.workers))} on this shift"
            + (f", with {n_advisory} further suggested." if n_advisory else ".")
        )
    elif n_advisory:
        parts.append(
            f"No controls are required at this reading; {n_advisory} routine "
            f"precaution{_s(n_advisory)} {_is(n_advisory)} suggested."
        )
    else:
        parts.append("No controls are required at this reading.")

    parts.append(
        "This plan was generated from the policy engine's decision without the language model, "
        "so the wording is fixed; the actions and their rule references are unaffected."
    )
    return " ".join(parts)


def _mitigation(action: PolicyActionPayload, origin: str) -> MitigationSuggestion:
    code = action.code
    return MitigationSuggestion(
        priority="HIGH" if origin == "MANDATORY" else "MEDIUM",
        action=ACTION_TEXT.get(code, _humanise(code)),
        # The policy engine's own reasoning string, verbatim. It already explains the decision
        # in terms of the actual threshold and the worker's acclimatisation level, and rewording
        # it here would be this file inventing an explanation for a decision it did not make.
        rationale=action.reasoning or f"Required by rule {action.ruleReference}",
        estimatedImpact=IMPACT_TEXT.get(code, "Reduces heat stress risk for the workers affected"),
        actionCode=code,
        category=CATEGORY_BY_CODE.get(code, "MONITORING"),
        origin=origin,
        ruleReference=action.ruleReference,
        # Empty appliesTo becomes None, not []: absent means "the whole shift" by the SCRUM-288
        # convention, whereas an empty list would read as "nobody" and dispatch to no one.
        appliesTo=list(action.appliesTo) or None,
        timing=TIMING_BY_CODE.get(code),
    )


def _humanise(code: str) -> str:
    """Last resort for a code with no fixed prose — never reached for a PolicyActionCode."""
    return code.replace("_", " ").capitalize()


def _s(n: int) -> str:
    return "" if n == 1 else "s"


def _is(n: int) -> str:
    return "is" if n == 1 else "are"
