"""Render a draft request into the context block the prompt inserts.

This function used to live in `test_agent_eval.py`, where it built the prompt for the §8.6
benchmark that selected the foundation model. It now lives here, in the production path, and
the benchmark imports it from here instead of owning its own copy.

That direction matters. A model was chosen on the strength of how it answered prompts built
by this code; if production quietly built its prompts a different way, the measurement that
justified the choice would no longer describe the system that shipped. One function, imported
by both, is the only arrangement where that cannot drift.

The layout is deliberately unchanged from the benchmarked version — same section order, same
wording, same em-dash separators. Everything added since (policy version, band, readiness
gaps) is strictly *additional* lines, never a rewrite of an existing one, so the 186 live
calls that picked claude-haiku-4-5 remain a fair description of this prompt.
"""
from typing import List, Optional

from agent.contract import AgentDraftRequest, PolicyActionPayload, WorkerContext


def render_context(request: AgentDraftRequest) -> str:
    """The "Policy and shift context" block that BedrockClient._build_prompt wraps."""
    policy = request.policyDecision
    lines = [f"Current WBGT: {request.currentWbgt}°C"]

    if request.forecastWbgt30m is not None:
        lines.append(f"Forecast WBGT (30 min): {request.forecastWbgt30m}°C")

    lines.append(f"Current WBGT band: {policy.currentBand}")
    if policy.forecastBand is not None:
        lines.append(f"Forecast WBGT band: {policy.forecastBand}")

    lines.append(f"Data freshness: {request.freshness}")
    lines.append(f"Lightning state: {request.lightningState}")
    lines.append(f"Heat policy version: {policy.policyVersion}")

    note = _situational_note(request)
    if note:
        lines.append(f"Additional note: {note}")

    lines.append("")
    lines.append("Shift roster:")
    if request.workers:
        for worker in request.workers:
            lines.append(
                f"  - {worker.workerId}: {worker.intensity} intensity, "
                f"acclimatisation day {worker.acclimatisationDay}"
            )
    else:
        lines.append("  (no workers currently assigned)")

    lines.append("")
    lines.append("MANDATORY actions (policy engine decided — every one of these must appear):")
    lines.extend(_action_lines(policy.mandatoryActions))
    lines.append("ADVISORY actions (policy engine decided — may be included):")
    lines.extend(_action_lines(policy.advisoryActions))

    return "\n".join(lines)


def _action_lines(actions: List[PolicyActionPayload]) -> List[str]:
    if not actions:
        return ["  (none)"]
    return [
        f"  - {a.code} (rule: {a.ruleReference}) — applies to: {', '.join(a.appliesTo)}"
        for a in actions
    ]


def _situational_note(request: AgentDraftRequest) -> Optional[str]:
    """Caveats the plan's prose should acknowledge, joined into the benchmark's `notes` slot.

    These change how the plan is *worded*, never what it *requires*. Deciding what is required
    is the policy engine's job, and it already applies its own conservative defaults (an
    assignment with no acclimatisation day is treated as day 1, the strictest tier). A renderer
    that added obligations here would be making safety decisions outside the audited engine —
    exactly the black box US-08 exists to prevent.
    """
    notes: List[str] = []

    if request.freshness in ("STALE", "DELAYED"):
        notes.append(
            f"the WBGT reading is {request.freshness}, so treat it as possibly outdated and "
            "present this plan as a precaution rather than a live assessment (§7.1)"
        )
    elif request.freshness == "SIMULATED":
        notes.append("the WBGT reading is simulated fixture data, not a live station reading")

    if request.lightningState == "ADVISORY":
        notes.append("lightning has been detected near the site and work may need to stop shortly")

    missing = _workers_without_readiness(request.workers)
    if missing:
        notes.append(
            f"{len(missing)} worker(s) have not submitted a pre-shift readiness check "
            f"({', '.join(missing)}); mention the gap, but do not treat it as grounds for any "
            "action the policy engine did not already mandate"
        )

    notes.extend(request.contextNotes)

    return "; ".join(notes) if notes else None


def _workers_without_readiness(workers: List[WorkerContext]) -> List[str]:
    return [w.workerId for w in workers if not w.readinessSubmitted]
