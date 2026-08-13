"""The backend <-> ml-service contract for POST /agent/draft.

Deliberately boring: field names match the Java side's own vocabulary (camelCase,
`PolicyDecision`/`PolicyAction` shapes lifted straight from
`com.crewsafe.policy.domain.PolicyDecision`) so a reader can hold both halves in their head
at once without a translation table.

The important structural point is `policyDecision` being **required**. The agent may not run
without one, and there is no code path that constructs a request without it — so §8.2's
"policy evaluation is compulsory before any LLM call" is enforced by the type, not by a rule
somebody has to remember to follow.
"""
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from models import MitigationSuggestion

# Mirrors com.crewsafe.weather.domain.WbgtBand's *wire* names (its @JsonProperty values, which
# drop the Java-identifier-legal BAND_ prefix), not its Java constant names.
WbgtBandName = Literal["BELOW_31", "31_TO_BELOW_32", "32_TO_BELOW_33", "33_AND_ABOVE"]

# Mirrors com.crewsafe.weather.domain.WeatherQualityStatus.
Freshness = Literal["LIVE", "DELAYED", "STALE", "SIMULATED"]

# Mirrors com.crewsafe.lightning.domain.LightningRiskState.
LightningState = Literal["CLEAR", "ADVISORY", "STOP_WORK"]


class WorkerContext(BaseModel):
    """One worker on the shift, as the backend's ShiftAssignment sees them."""

    workerId: str
    intensity: Literal["LIGHT", "MODERATE", "HEAVY"]
    acclimatisationDay: int = Field(..., ge=1, le=365)
    readinessSubmitted: bool = Field(
        False,
        description=(
            "Whether this worker filed a pre-shift readiness answer. Context only: a missing "
            "readiness submission is a gap the plan should mention, never a reason to invent "
            "an obligation the policy engine did not mandate."
        ),
    )


class PolicyActionPayload(BaseModel):
    """One action the policy engine decided on — the Java PolicyDecision.PolicyAction."""

    code: str = Field(..., min_length=1)
    ruleReference: str = Field(..., min_length=1)
    appliesTo: List[str] = Field(default_factory=list)
    reasoning: str = ""


class PolicyDecisionPayload(BaseModel):
    """The whole policy engine result. Required on every draft request — see module docstring."""

    policyVersion: str = Field(..., min_length=1)
    currentBand: WbgtBandName
    forecastBand: Optional[WbgtBandName] = None
    mandatoryActions: List[PolicyActionPayload] = Field(default_factory=list)
    advisoryActions: List[PolicyActionPayload] = Field(default_factory=list)


class AgentDraftRequest(BaseModel):
    """Everything the agent needs, gathered in-process by the backend's AgentDraftService."""

    shiftId: str
    siteId: str
    currentWbgt: float = Field(..., ge=-10, le=60)
    forecastWbgt30m: Optional[float] = Field(
        None,
        description=(
            "Optional. The backend has no forecast source of its own today, so it normally "
            "omits this and the graph derives it locally via ForecastService. Supplied values "
            "win, so a future backend-side forecast needs no change here."
        ),
    )
    freshness: Freshness = "LIVE"
    lightningState: LightningState = "CLEAR"
    workers: List[WorkerContext] = Field(default_factory=list)
    contextNotes: List[str] = Field(
        default_factory=list,
        description=(
            "Situational context the plan's prose should acknowledge — a worker's raised "
            "concern, a dispatch unacknowledged for too long. Three §8.6 coverage buckets "
            "(worker_concern, missing_ack, missing_readiness) exercise exactly this, so the "
            "slot exists for the benchmark and production to build identical prompts.\n\n"
            "SECURITY: server-composed sentences only. These strings reach the model inside "
            "its prompt, so passing raw worker-entered text through here would be a prompt "
            "injection path. The backend currently sends none; whoever wires up concern text "
            "(SCRUM-125's WellbeingLog/Concern) must summarise it server-side, not forward it."
        ),
    )
    policyDecision: PolicyDecisionPayload


class DraftedPlan(BaseModel):
    """What Bedrock is constrained to return: a plan-level rationale plus the mitigations.

    Deliberately separate from `models.MitigationBatch` rather than adding a field to it.
    MitigationBatch is the schema the §8.6 benchmark measured six models against and the shape
    `/bedrock/suggest` still serves; widening it would have silently changed what the model
    selection was based on. A second model costs one class and keeps that measurement honest.
    """

    rationale: str = Field(
        ...,
        min_length=1,
        max_length=1200,
        description=(
            "One paragraph explaining the plan as a whole: what was measured, what it means, "
            "and why these actions follow. Not a summary of the list below."
        ),
    )
    mitigations: List[MitigationSuggestion] = Field(..., min_length=0, max_length=10)


class AgentDraftResponse(BaseModel):
    """What the backend persists and audits.

    `rationale` is top-level and required, separate from each mitigation's own rationale,
    because mobile's RecommendationDetailScreen renders a whole-plan explanation paragraph
    prominently above the mitigation list. A per-mitigation rationale cannot fill that slot.
    """

    rationale: str = Field(..., min_length=1)
    mitigations: List[MitigationSuggestion] = Field(default_factory=list)
    modelId: str = Field(..., description="Bedrock model that produced the draft, or 'none' when it did not run")
    usedFallback: bool = Field(..., description="True when the deterministic template produced this plan")
    fallbackReason: Optional[str] = Field(
        None, description="Why the LLM path was abandoned. Null on the happy path; audited when set."
    )
    forecastWbgt30m: Optional[float] = None
    forecastModelVersion: Optional[str] = Field(
        None,
        description=(
            "Version of the forecast that produced forecastWbgt30m. Currently 'baseline-1.0.0', "
            "a persistence baseline whose prediction equals the present reading (SCRUM-281 "
            "replaces it with the trained model). Surfaced so nobody mistakes it for a real one."
        ),
    )
    inputTokens: int = 0
    outputTokens: int = 0
