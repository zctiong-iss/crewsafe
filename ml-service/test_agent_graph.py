"""Offline tests for the agent graph, its validation gate and its deterministic fallback.

No Bedrock call happens here. The graph's only outside dependency is `BedrockClient.invoke`,
which every test replaces with a stub — so these run in CI, in a container with no AWS
credentials, and in a few milliseconds.

The live half of the verification (does the real model, on the real prompt, actually produce
plans that clear this gate?) is `test_agent_eval.py`, which is a billed benchmark and is not
part of the automated suite. Both halves are needed: this file proves the machinery around the
model is correct, that one proves the model is good enough for the machinery to rarely fire.
"""
from typing import List, Optional

import pytest

from agent import graph as graph_module
from agent.contract import AgentDraftRequest, DraftedPlan, PolicyActionPayload, PolicyDecisionPayload, WorkerContext
from agent.fallback import build_fallback_plan, build_fallback_rationale
from agent.graph import draft_plan
from agent.validation import ALLOWED_ACTION_CODES, validate
from models import MitigationBatch, MitigationSuggestion

MODEL_ID = "global.anthropic.claude-haiku-4-5-20251001-v1:0"
WORKER_A = "11111111-1111-1111-1111-111111111111"
WORKER_B = "22222222-2222-2222-2222-222222222222"


# --------------------------------------------------------------------------------------
# Fixtures
# --------------------------------------------------------------------------------------

def a_request(
    *,
    mandatory: Optional[List[PolicyActionPayload]] = None,
    advisory: Optional[List[PolicyActionPayload]] = None,
    current_wbgt: float = 32.5,
    freshness: str = "LIVE",
    lightning: str = "CLEAR",
    workers: Optional[List[WorkerContext]] = None,
) -> AgentDraftRequest:
    return AgentDraftRequest(
        shiftId="shift-1",
        siteId="site-1",
        currentWbgt=current_wbgt,
        freshness=freshness,
        lightningState=lightning,
        workers=workers if workers is not None else [
            WorkerContext(workerId=WORKER_A, intensity="HEAVY", acclimatisationDay=2, readinessSubmitted=True),
            WorkerContext(workerId=WORKER_B, intensity="LIGHT", acclimatisationDay=9, readinessSubmitted=False),
        ],
        policyDecision=PolicyDecisionPayload(
            policyVersion="MOM-WBGT-2026.1",
            currentBand="32_TO_BELOW_33",
            forecastBand="32_TO_BELOW_33",
            mandatoryActions=mandatory if mandatory is not None else [
                PolicyActionPayload(code="REST_15_MIN_HOURLY", ruleReference="UNACCLIMATISED_HEAVY_WORK_RULE",
                                    appliesTo=[WORKER_A], reasoning="WBGT 32.5°C exceeds threshold 22.0°C"),
                PolicyActionPayload(code="HYDRATE_HOURLY", ruleReference="UNACCLIMATISED_HEAVY_WORK_RULE",
                                    appliesTo=[WORKER_A, WORKER_B], reasoning="Fluid replacement required"),
            ],
            advisoryActions=advisory if advisory is not None else [
                PolicyActionPayload(code="CLOSE_MONITORING", ruleReference="UNACCLIMATISED_HEAVY_WORK_RULE",
                                    appliesTo=[WORKER_A], reasoning="Watch for heat illness"),
            ],
        ),
    )


def a_mitigation(**overrides) -> MitigationSuggestion:
    base = dict(
        priority="HIGH", action="Rest 15 minutes in shade every hour",
        rationale="WBGT exceeds this worker's threshold", estimatedImpact="Lowers core temperature",
        actionCode="REST_15_MIN_HOURLY", category="REST", origin="MANDATORY",
        ruleReference="UNACCLIMATISED_HEAVY_WORK_RULE", appliesTo=[WORKER_A],
    )
    base.update(overrides)
    return MitigationSuggestion(**base)


def a_valid_plan(request: AgentDraftRequest) -> DraftedPlan:
    """A model response that agrees with the policy decision on every point."""
    policy = request.policyDecision
    mitigations = [
        a_mitigation(actionCode=a.code, ruleReference=a.ruleReference, appliesTo=list(a.appliesTo),
                     origin=origin, category="REST")
        for actions, origin in ((policy.mandatoryActions, "MANDATORY"), (policy.advisoryActions, "ADVISORY"))
        for a in actions
    ]
    return DraftedPlan(rationale="A model-written explanation of the whole plan.", mitigations=mitigations)


class StubClient:
    """Stands in for BedrockClient. `responses` is consumed one per attempt."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def invoke(self, context, model_id=MODEL_ID, max_tokens=1024, temperature=0.7,
               response_model=None, extra_instructions=""):
        self.calls.append({"context": context, "model_id": model_id, "max_tokens": max_tokens})
        nxt = self.responses.pop(0)
        if isinstance(nxt, Exception):
            raise nxt
        return nxt, 1234.0, 900, 600


@pytest.fixture(autouse=True)
def reset_graph_singletons():
    """The graph caches a compiled graph and a client in module globals; keep tests independent."""
    graph_module._graph = None
    yield
    graph_module.set_bedrock_client(None)
    graph_module._graph = None


# --------------------------------------------------------------------------------------
# Validation gate
# --------------------------------------------------------------------------------------

def test_valid_plan_passes_the_gate():
    request = a_request()
    plan = a_valid_plan(request)
    assert validate(plan, request.policyDecision, [WORKER_A, WORKER_B]) == []


def test_invented_action_code_is_rejected():
    request = a_request()
    plan = DraftedPlan(rationale="x", mitigations=[a_mitigation(actionCode="TAKE_A_NAP")])
    checks = {v.check for v in validate(plan, request.policyDecision, [WORKER_A, WORKER_B])}
    assert "unknown_action_code" in checks


def test_omitted_mandatory_action_is_rejected():
    """AT-11's core case: the model drops a required control and the plan still looks complete."""
    request = a_request()
    full = a_valid_plan(request)
    without_hydration = DraftedPlan(
        rationale=full.rationale,
        mitigations=[m for m in full.mitigations if m.actionCode != "HYDRATE_HOURLY"],
    )
    violations = validate(without_hydration, request.policyDecision, [WORKER_A, WORKER_B])
    assert [v.check for v in violations] == ["missing_mandatory_action"]
    assert "HYDRATE_HOURLY" in violations[0].detail


def test_mandatory_action_downgraded_to_advisory_is_rejected():
    """The silent weakening: everything is present, but the supervisor is now free to delete it."""
    request = a_request()
    plan = DraftedPlan(rationale="x", mitigations=[a_mitigation(origin="ADVISORY")])
    checks = {v.check for v in validate(plan, request.policyDecision, [WORKER_A, WORKER_B])}
    assert "wrong_origin" in checks


def test_action_the_policy_engine_never_decided_is_rejected():
    request = a_request()
    plan = DraftedPlan(rationale="x", mitigations=[
        a_mitigation(actionCode="SHADE_RECOVERY", ruleReference="SAFE_WORK_RULE", origin="ADVISORY")])
    checks = {v.check for v in validate(plan, request.policyDecision, [WORKER_A, WORKER_B])}
    assert "unmandated_action" in checks


def test_wrong_rule_citation_is_rejected():
    request = a_request()
    plan = DraftedPlan(rationale="x", mitigations=[a_mitigation(ruleReference="SAFE_WORK_RULE")])
    checks = {v.check for v in validate(plan, request.policyDecision, [WORKER_A, WORKER_B])}
    assert "wrong_rule_reference" in checks


def test_worker_not_on_the_shift_is_rejected():
    request = a_request()
    plan = DraftedPlan(rationale="x", mitigations=[a_mitigation(appliesTo=["99999999-9999-9999-9999-999999999999"])])
    checks = {v.check for v in validate(plan, request.policyDecision, [WORKER_A, WORKER_B])}
    assert "unknown_worker" in checks


# --------------------------------------------------------------------------------------
# Deterministic fallback
# --------------------------------------------------------------------------------------

def test_fallback_plan_passes_its_own_validation_gate():
    """The property that makes the fallback a real answer rather than a placeholder.

    If the deterministic plan could not clear the same gate a model's plan must clear, the
    system would have no guaranteed-valid output at all and the graph's last node would be a
    lie. Asserting it here means the two can never drift apart unnoticed.
    """
    request = a_request()
    batch = build_fallback_plan(request)
    plan = DraftedPlan(rationale=build_fallback_rationale(request), mitigations=batch.mitigations)
    assert validate(plan, request.policyDecision, [WORKER_A, WORKER_B]) == []


def test_fallback_covers_every_policy_action_with_the_right_origin():
    request = a_request()
    batch = build_fallback_plan(request)
    by_code = {m.actionCode: m for m in batch.mitigations}

    assert set(by_code) == {"REST_15_MIN_HOURLY", "HYDRATE_HOURLY", "CLOSE_MONITORING"}
    assert by_code["REST_15_MIN_HOURLY"].origin == "MANDATORY"
    assert by_code["REST_15_MIN_HOURLY"].priority == "HIGH"
    assert by_code["CLOSE_MONITORING"].origin == "ADVISORY"
    assert by_code["CLOSE_MONITORING"].priority == "MEDIUM"


def test_fallback_timing_comes_from_the_code_not_from_prose():
    request = a_request()
    by_code = {m.actionCode: m for m in build_fallback_plan(request).mitigations}

    assert by_code["REST_15_MIN_HOURLY"].timing.durationMinutes == 15
    assert by_code["REST_15_MIN_HOURLY"].timing.everyMinutes == 60
    assert by_code["HYDRATE_HOURLY"].timing.everyMinutes == 60
    assert by_code["HYDRATE_HOURLY"].timing.durationMinutes is None
    # CLOSE_MONITORING has no inherent schedule, so it carries no timing rather than a made-up one.
    assert by_code["CLOSE_MONITORING"].timing is None


def test_fallback_rationale_names_the_reading_the_band_and_the_policy_version():
    """§12.2: a recommendation must always surface what decided it."""
    rationale = build_fallback_rationale(a_request())
    assert "32.5" in rationale
    assert "between 32°C and 33°C" in rationale
    assert "MOM-WBGT-2026.1" in rationale


def test_fallback_rationale_leads_with_staleness_when_the_reading_is_old():
    rationale = build_fallback_rationale(a_request(freshness="STALE"))
    assert rationale.startswith("The most recent WBGT reading is stale")
    assert "precautionary" in rationale


def test_fallback_handles_a_decision_with_no_actions_at_all():
    request = a_request(mandatory=[], advisory=[])
    assert build_fallback_plan(request).mitigations == []
    assert "No controls are required" in build_fallback_rationale(request)


def test_fallback_uses_none_not_empty_list_for_whole_shift_targeting():
    """Absent appliesTo means the whole shift; an empty list would dispatch to nobody."""
    request = a_request(mandatory=[PolicyActionPayload(
        code="HYDRATE_HOURLY", ruleReference="HEAT_STRESS_REST_RULE", appliesTo=[], reasoning="r")], advisory=[])
    assert build_fallback_plan(request).mitigations[0].appliesTo is None


def test_every_fallback_action_code_is_in_the_allowlist():
    """The fallback builds codes from the policy decision, so this holds by construction —
    asserted anyway, because it is the one place a typo in the prose tables could smuggle an
    unrenderable code into a plan that skips the model entirely."""
    from agent.fallback import ACTION_TEXT, CATEGORY_BY_CODE, IMPACT_TEXT, TIMING_BY_CODE

    for table in (ACTION_TEXT, IMPACT_TEXT, CATEGORY_BY_CODE, TIMING_BY_CODE):
        assert set(table) <= ALLOWED_ACTION_CODES


# --------------------------------------------------------------------------------------
# Graph routing
# --------------------------------------------------------------------------------------

def test_happy_path_ships_the_model_plan_without_falling_back():
    request = a_request()
    stub = StubClient([a_valid_plan(request)])
    graph_module.set_bedrock_client(stub)

    response = draft_plan(request, model_id=MODEL_ID)

    assert response.usedFallback is False
    assert response.fallbackReason is None
    assert response.modelId == MODEL_ID
    assert response.rationale == "A model-written explanation of the whole plan."
    assert len(stub.calls) == 1
    assert response.inputTokens == 900 and response.outputTokens == 600


def test_one_bad_draft_is_retried_and_the_retry_ships():
    """The near-miss case the single retry exists for."""
    request = a_request()
    bad = DraftedPlan(rationale="x", mitigations=[a_mitigation(actionCode="TAKE_A_NAP")])
    stub = StubClient([bad, a_valid_plan(request)])
    graph_module.set_bedrock_client(stub)

    response = draft_plan(request, model_id=MODEL_ID)

    assert len(stub.calls) == 2
    assert response.usedFallback is False
    # Both attempts are billed, so both are reported.
    assert response.inputTokens == 1800 and response.outputTokens == 1200


def test_two_bad_drafts_fall_back_and_still_return_a_plan():
    """AT-11 end to end: an invalid draft is discarded, a deterministic plan is persisted."""
    request = a_request()
    bad = DraftedPlan(rationale="x", mitigations=[a_mitigation(actionCode="TAKE_A_NAP")])
    stub = StubClient([bad, bad])
    graph_module.set_bedrock_client(stub)

    response = draft_plan(request, model_id=MODEL_ID)

    assert len(stub.calls) == 2, "the graph must not retry forever"
    assert response.usedFallback is True
    assert "unknown_action_code" in response.fallbackReason
    assert response.modelId == "none", "a discarded draft must not be attributed to the model"
    assert {m.actionCode for m in response.mitigations} == {
        "REST_15_MIN_HOURLY", "HYDRATE_HOURLY", "CLOSE_MONITORING"}


def test_bedrock_failure_falls_back_immediately_without_retrying():
    """Throttling that survived the SDK's own 8 retries is not worth a 9th."""
    request = a_request()
    stub = StubClient([RuntimeError("throttled after 8 retries")])
    graph_module.set_bedrock_client(stub)

    response = draft_plan(request, model_id=MODEL_ID)

    assert len(stub.calls) == 1
    assert response.usedFallback is True
    assert "bedrock_unavailable" in response.fallbackReason
    assert response.mitigations, "an unavailable model must still produce a plan"


def test_missing_mandatory_action_falls_back_rather_than_shipping_a_short_plan():
    request = a_request()
    full = a_valid_plan(request)
    short = DraftedPlan(rationale="x",
                        mitigations=[m for m in full.mitigations if m.actionCode != "HYDRATE_HOURLY"])
    graph_module.set_bedrock_client(StubClient([short, short]))

    response = draft_plan(request, model_id=MODEL_ID)

    assert response.usedFallback is True
    assert "missing_mandatory_action" in response.fallbackReason
    assert any(m.actionCode == "HYDRATE_HOURLY" for m in response.mitigations)


def test_max_tokens_is_sized_from_the_action_count():
    """The SCRUM-287 truncation bug: a fixed 1024 cap cut multi-worker plans off mid-JSON."""
    many = [PolicyActionPayload(code=code, ruleReference="HEAT_STRESS_REST_RULE",
                                appliesTo=[WORKER_A], reasoning="r")
            for code in ("REST_10_MIN_HOURLY", "HYDRATE_HOURLY", "CLOSE_MONITORING",
                         "SHADE_RECOVERY", "RESCHEDULE_HEAVY_WORK", "ROTATE_TO_LIGHT_DUTY")]
    request = a_request(mandatory=many[:3], advisory=many[3:])
    stub = StubClient([a_valid_plan(request)])
    graph_module.set_bedrock_client(stub)

    draft_plan(request, model_id=MODEL_ID)

    assert stub.calls[0]["max_tokens"] == 400 + 300 * 6


def test_forecast_is_filled_in_and_reported_with_its_model_version():
    """Today's forecast is a persistence baseline, so it equals the current reading. The
    version is surfaced so nobody reads that number as a prediction (SCRUM-281 replaces it)."""
    request = a_request(current_wbgt=32.5)
    graph_module.set_bedrock_client(StubClient([a_valid_plan(request)]))

    response = draft_plan(request, model_id=MODEL_ID)

    assert response.forecastWbgt30m == 32.5
    assert response.forecastModelVersion == "baseline-1.0.0"


def test_a_supplied_forecast_wins_over_the_local_one():
    request = a_request()
    request.forecastWbgt30m = 34.0
    graph_module.set_bedrock_client(StubClient([a_valid_plan(request)]))

    response = draft_plan(request, model_id=MODEL_ID)

    assert response.forecastWbgt30m == 34.0
    assert response.forecastModelVersion is None


def test_the_prompt_carries_the_policy_decision_and_the_roster():
    """The model must never have to guess what was mandated — §8.2's whole point."""
    request = a_request()
    stub = StubClient([a_valid_plan(request)])
    graph_module.set_bedrock_client(stub)

    draft_plan(request, model_id=MODEL_ID)
    context = stub.calls[0]["context"]

    assert "MANDATORY actions" in context
    assert "REST_15_MIN_HOURLY (rule: UNACCLIMATISED_HEAVY_WORK_RULE)" in context
    assert "MOM-WBGT-2026.1" in context
    assert WORKER_A in context and WORKER_B in context
    # WORKER_B filed no readiness check, and the prompt says so without turning it into a mandate.
    assert "readiness check" in context
    assert "do not treat it as grounds for any action" in context
