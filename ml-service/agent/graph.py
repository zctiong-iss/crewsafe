"""The LangGraph agent graph: forecast -> draft -> validate -> (done | retry | fallback).

    ┌──────────┐   ┌───────┐   ┌──────────┐  valid   ┌─────┐
    │ forecast │──▶│ draft │──▶│ validate │─────────▶│ END │
    └──────────┘   └───────┘   └──────────┘          └─────┘
                       ▲            │ invalid, 1st try
                       └────────────┤
                                    │ invalid again, or Bedrock failed
                                    ▼
                              ┌──────────┐
                              │ fallback │──▶ END
                              └──────────┘

Why a graph rather than an if/else. What this models is not a sequence of steps — it is a
*trust boundary* with three exits, and the value of writing it as a state machine is that the
exits are enumerated in one place. `_route_after_validate` is nine lines and is the entire
policy for when a language model's output is allowed to reach a supervisor. Reviewing that
question means reading those nine lines, not tracing control flow through a service method.
The deferred work in the design doc (auto-trigger on band change, LangSmith tracing) attaches
to this structure without rewriting it.

Why only one retry. The failures the validator catches are not transient — a model that
dropped a mandatory action is misreading the context, and a third attempt against the same
context mostly buys latency on a request a supervisor is already waiting on. One retry covers
the genuinely stochastic near-miss; after that the deterministic plan is both faster and
certain, and it is a real plan, not an error page.

Deviation from the plan doc, recorded deliberately: the doc names three nodes and this has
four. `forecast` exists because the forecast is the one piece of context the backend cannot
gather — no Java forecast source exists — so it is the minimal Python-side remainder of §8.2's
"gather context" step. It is a node rather than a line inside `draft` so that its failure is
visible in the graph's own state instead of being buried in prompt assembly.
"""
import logging
from typing import List, Optional, TypedDict

from langgraph.graph import END, START, StateGraph

from agent.contract import AgentDraftRequest, AgentDraftResponse, DraftedPlan
from agent.context import render_context
from agent.fallback import build_fallback_plan, build_fallback_rationale
from agent.validation import Violation, validate
from bedrock_client import BedrockClient
from forecast_service import ForecastService

logger = logging.getLogger(__name__)

MAX_DRAFT_ATTEMPTS = 2

# Appended to BedrockClient's benchmarked prompt (never edited into it) so the prompt the §8.6
# measurement used remains a literal prefix of the one production sends.
PLAN_RATIONALE_INSTRUCTION = """Also produce a top-level "rationale": one short paragraph
addressed to the supervisor, explaining the situation as a whole — what the reading is, what it
means for this crew, and why these actions follow from it. It must be a genuine explanation of
the plan, not a restatement of the list. Each mitigation still carries its own separate
rationale for that specific action."""


class DraftState(TypedDict, total=False):
    """What flows between nodes. Everything the response needs is accumulated here."""

    request: AgentDraftRequest
    plan: Optional[DraftedPlan]
    violations: List[Violation]
    attempts: int
    model_id: str
    input_tokens: int
    output_tokens: int
    used_fallback: bool
    fallback_reason: Optional[str]
    forecast_wbgt_30m: Optional[float]
    forecast_model_version: Optional[str]


def _forecast_node(state: DraftState) -> DraftState:
    """Fill in the 30-minute forecast the backend could not supply.

    ForecastService is a plain in-process call, not an HTTP round trip to this same service's
    own /forecast route — the plan doc describes it as "let the Python side call /forecast",
    and calling ourselves over the loopback would add a failure mode for nothing. The endpoint
    stays as the contract for external callers.

    As of SCRUM-289's backend wiring, this node's own forecast is the fallback path, not the
    normal one. AgentDraftService now calls SiteForecastService before it builds the request,
    so `request.forecastWbgt30m` usually arrives already set to a real trained-model prediction
    and the early return below fires immediately — this node's ForecastService() call and its
    persistence baseline never run. They still exist for two reasons: a request built without
    going through AgentDraftService (a test, a future caller) has no such guarantee, and the
    backend itself passes `None` through here whenever *its* SiteForecastService call couldn't
    produce one — new site, stale/simulated reading, ml-service unreachable (§7.1: a missing
    input degrades the output, it does not fail the request). Either way this node is what
    guarantees the plan always has *a* forecast figure, even if only the present standing in
    for it. `forecast_model_version` is how a caller tells the two cases apart: null means the
    backend supplied a real one, `"baseline-1.0.0"` means this node's fallback ran.
    """
    request = state["request"]
    if request.forecastWbgt30m is not None:
        return {"forecast_wbgt_30m": request.forecastWbgt30m, "forecast_model_version": None}

    try:
        # A bare ForecastService(), not ForecastService.from_environment(). The trained model
        # (SCRUM-281) only engages when handed a ForecastContext - recent 15-minute
        # observations, station id, coordinates - and this node has none of that: it holds one
        # scalar reading, reached only once the backend's own attempt (with the real context)
        # has already come back empty. from_environment() would load and checksum the model
        # bundle on every one of those calls and then take the same context is None branch back
        # to this same baseline, so it would buy latency and a new failure mode for no benefit.
        prediction = ForecastService().forecast(
            metric="wbgt", current_value=request.currentWbgt, horizon_minutes=30)
        request.forecastWbgt30m = prediction.predicted_value
        return {
            "forecast_wbgt_30m": prediction.predicted_value,
            "forecast_model_version": prediction.model_version,
        }
    except Exception as e:
        # §7.1: an unavailable forecast degrades to null, it does not fail the request. The
        # plan is drafted from the current reading, which is the safety-relevant number anyway.
        logger.warning("Forecast unavailable, drafting without one: %s", e)
        return {"forecast_wbgt_30m": None, "forecast_model_version": None}


def _draft_node(state: DraftState) -> DraftState:
    """Ask Bedrock to turn the policy decision into prose."""
    request = state["request"]
    attempts = state.get("attempts", 0) + 1
    context = render_context(request)

    policy = request.policyDecision
    n_actions = max(1, len(policy.mandatoryActions) + len(policy.advisoryActions))
    # Sized from the action count, not left at the client default. During the SCRUM-287
    # benchmark the 1024 default truncated every multi-worker response mid-JSON, which surfaced
    # as an empty schema-invalid tool call and looked exactly like a model quality problem; an
    # 8-mitigation scenario needed 1,508 output tokens.
    max_tokens = min(4096, max(1024, 400 + 300 * n_actions))

    try:
        plan, latency_ms, in_tok, out_tok = _client().invoke(
            context=context,
            model_id=state["model_id"],
            max_tokens=max_tokens,
            response_model=DraftedPlan,
            extra_instructions=PLAN_RATIONALE_INSTRUCTION,
        )
    except Exception as e:
        # Includes throttling that survived the SDK's own 8 retries, which this account does
        # produce under modest burst. There is nothing useful left to retry here, so the router
        # sends this straight to fallback rather than spending another attempt.
        logger.warning("Bedrock draft attempt %d failed: %s", attempts, e)
        return {
            "plan": None,
            "attempts": attempts,
            "fallback_reason": f"bedrock_unavailable: {e}",
            "input_tokens": state.get("input_tokens", 0),
            "output_tokens": state.get("output_tokens", 0),
        }

    logger.info(
        "Draft attempt %d: %d mitigations in %.0fms (%d+%d tokens)",
        attempts, len(plan.mitigations), latency_ms, in_tok, out_tok,
    )
    return {
        "plan": plan,
        "attempts": attempts,
        # Accumulated across attempts: a retried draft really did cost two calls, and an audit
        # trail that reported only the successful one would understate what was spent.
        "input_tokens": state.get("input_tokens", 0) + in_tok,
        "output_tokens": state.get("output_tokens", 0) + out_tok,
    }


def _validate_node(state: DraftState) -> DraftState:
    """Check the draft against the policy decision it was supposed to be rendering."""
    plan = state.get("plan")
    if plan is None:
        return {"violations": []}

    request = state["request"]
    roster = [w.workerId for w in request.workers]
    violations = validate(plan, request.policyDecision, roster)

    if violations:
        logger.warning(
            "Draft attempt %d failed validation: %s",
            state.get("attempts", 0), "; ".join(str(v) for v in violations),
        )
    return {"violations": violations}


def _fallback_node(state: DraftState) -> DraftState:
    """Build the plan deterministically. Always succeeds; see agent/fallback.py."""
    request = state["request"]
    violations = state.get("violations", [])
    reason = state.get("fallback_reason") or (
        "validation_failed: " + "; ".join(str(v) for v in violations) if violations else "unknown"
    )
    logger.info("Falling back to the deterministic plan (%s)", reason)

    return {
        "plan": DraftedPlan(
            rationale=build_fallback_rationale(request),
            mitigations=build_fallback_plan(request).mitigations,
        ),
        "used_fallback": True,
        "fallback_reason": reason,
    }


def _route_after_draft(state: DraftState) -> str:
    """A draft that never came back cannot be validated."""
    return "validate" if state.get("plan") is not None else "fallback"


def _route_after_validate(state: DraftState) -> str:
    """The whole trust policy for model output, in one place.

    Clean draft ships. A first failure is retried once, on the theory that a near-miss on a
    stochastic system is worth one more sample. A second failure is not treated as bad luck —
    it is treated as this context being one the model is getting wrong, and the deterministic
    plan takes over.
    """
    if not state.get("violations"):
        return "done"
    if state.get("attempts", 0) < MAX_DRAFT_ATTEMPTS:
        return "retry"
    return "fallback"


def build_graph():
    """Compile the graph. Cheap and stateless — the caller may cache or rebuild freely."""
    builder = StateGraph(DraftState)
    builder.add_node("forecast", _forecast_node)
    builder.add_node("draft", _draft_node)
    builder.add_node("validate", _validate_node)
    builder.add_node("fallback", _fallback_node)

    builder.add_edge(START, "forecast")
    builder.add_edge("forecast", "draft")
    builder.add_conditional_edges("draft", _route_after_draft,
                                  {"validate": "validate", "fallback": "fallback"})
    builder.add_conditional_edges("validate", _route_after_validate,
                                  {"done": END, "retry": "draft", "fallback": "fallback"})
    builder.add_edge("fallback", END)
    return builder.compile()


_graph = None
_bedrock_client: Optional[BedrockClient] = None


def _client() -> BedrockClient:
    """One client for the process, matching how app.py already holds its own."""
    global _bedrock_client
    if _bedrock_client is None:
        _bedrock_client = BedrockClient()
    return _bedrock_client


def set_bedrock_client(client: Optional[BedrockClient]) -> None:
    """Injection point for app startup (which already builds a verified client) and for tests."""
    global _bedrock_client
    _bedrock_client = client


def draft_plan(request: AgentDraftRequest, model_id: str) -> AgentDraftResponse:
    """Run the graph and shape its final state into the backend's response.

    Never raises for a modelling failure — every path through the graph ends with a plan. The
    caller distinguishes the two outcomes by `usedFallback`, not by an error.
    """
    global _graph
    if _graph is None:
        _graph = build_graph()

    final: DraftState = _graph.invoke({
        "request": request,
        "model_id": model_id,
        "attempts": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "used_fallback": False,
    })

    plan = final["plan"]
    used_fallback = final.get("used_fallback", False)
    return AgentDraftResponse(
        rationale=plan.rationale,
        mitigations=plan.mitigations,
        # "none" rather than the configured model id when the model never produced the plan —
        # an audit row naming a model that did not write this plan would be worse than no name.
        modelId="none" if used_fallback else model_id,
        usedFallback=used_fallback,
        fallbackReason=final.get("fallback_reason") if used_fallback else None,
        forecastWbgt30m=final.get("forecast_wbgt_30m"),
        forecastModelVersion=final.get("forecast_model_version"),
        inputTokens=final.get("input_tokens", 0),
        outputTokens=final.get("output_tokens", 0),
    )
