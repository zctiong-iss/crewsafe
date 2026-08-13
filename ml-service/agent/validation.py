"""The §8.5 gate: decide whether a drafted plan may be shown to a supervisor at all.

The design principle is that the model is trusted to *phrase* a plan, never to *decide* one.
Every check below compares the draft against the policy engine's decision, which was made
before the model ran and is the only authority on what is actually required. A draft that
disagrees with it is discarded outright — not corrected, not partially accepted.

Three of these checks are promoted from `eval_scoring.py`, where they were the §8.6 metrics
that graded candidate models. The same conditions that decided which model to trust now decide
whether to trust any individual answer from it, which is the arrangement that makes the
benchmark mean something operationally rather than being a one-off report.

Failing here is not an error state. It routes to `fallback`, which always produces a valid
plan. A supervisor never sees a validation failure; they see a plainer plan.
"""
from dataclasses import dataclass
from typing import Dict, List, Set

from agent.contract import PolicyDecisionPayload
from models import MitigationBatch

# Mirrors backend/src/main/java/com/crewsafe/policy/domain/PolicyActionCode.java exactly, and is
# re-exported to eval_scoring so the benchmark and the production gate can never disagree about
# what counts as a real action code.
ALLOWED_ACTION_CODES: Set[str] = {
    "STOP_WORK", "RESUME_WORK", "REST_10_MIN_HOURLY", "REST_15_MIN_HOURLY",
    "HYDRATE_HOURLY", "HYDRATE_REGULARLY", "SHADE_RECOVERY",
    "RESCHEDULE_HEAVY_WORK", "ROTATE_TO_LIGHT_DUTY", "CLOSE_MONITORING",
}


@dataclass(frozen=True)
class Violation:
    """One failed check. `check` is a stable identifier; `detail` is for humans and audit rows."""

    check: str
    detail: str

    def __str__(self) -> str:
        return f"{self.check}: {self.detail}"


def validate(batch: MitigationBatch, policy: PolicyDecisionPayload, roster: List[str]) -> List[Violation]:
    """Every way this draft disagrees with the policy decision. Empty list means it may ship."""
    violations: List[Violation] = []
    violations.extend(_unknown_action_codes(batch))
    violations.extend(_missing_mandatory_actions(batch, policy))
    violations.extend(_unmandated_actions(batch, policy))
    violations.extend(_wrong_origin(batch, policy))
    violations.extend(_wrong_rule_reference(batch, policy))
    violations.extend(_unknown_workers(batch, roster))
    return violations


def _unknown_action_codes(batch: MitigationBatch) -> List[Violation]:
    """An invented action code is the §8.6 gate condition and the one hard disqualifier.

    A code outside the catalogue has no translation in any of the app's seven locales, so it
    would reach a worker as English prose humanised from the identifier — the precise failure
    the allowlist exists to prevent. Across 186 benchmark calls no candidate model ever did
    this; the check stays because "never happened yet" is not a guarantee.
    """
    return [
        Violation("unknown_action_code", f"'{m.actionCode}' is not in the action catalogue")
        for m in batch.mitigations
        if m.actionCode not in ALLOWED_ACTION_CODES
    ]


def _missing_mandatory_actions(batch: MitigationBatch, policy: PolicyDecisionPayload) -> List[Violation]:
    """The worst failure this system has: a required action silently dropped from the plan.

    §8.1 forbids the agent omitting or weakening a mandatory action, and §8.5 says a plan
    missing a policy reference cannot be approved. A supervisor reading a plan reasonably
    assumes it is complete, so an omission here is invisible to exactly the person whose job
    it is to catch it.
    """
    drafted = {m.actionCode for m in batch.mitigations}
    return [
        Violation("missing_mandatory_action", f"policy mandated '{a.code}' but the draft omits it")
        for a in policy.mandatoryActions
        if a.code not in drafted
    ]


def _unmandated_actions(batch: MitigationBatch, policy: PolicyDecisionPayload) -> List[Violation]:
    """An action the policy engine never decided on, presented as though it had.

    The code may be a real one and the mitigation may even be sensible advice — but it would
    arrive carrying a `ruleReference` no rule produced, and a supervisor cannot audit it back
    to anything. Advice that cannot be traced to the engine is the black box US-08 exists to
    prevent, so it is rejected even when it looks helpful.
    """
    decided = {a.code for a in policy.mandatoryActions + policy.advisoryActions}
    return [
        Violation("unmandated_action", f"'{m.actionCode}' was not in the policy decision")
        for m in batch.mitigations
        if m.actionCode in ALLOWED_ACTION_CODES and m.actionCode not in decided
    ]


def _wrong_origin(batch: MitigationBatch, policy: PolicyDecisionPayload) -> List[Violation]:
    """MANDATORY vs ADVISORY, backwards.

    `origin` is what tells the supervisor's app whether the remove button is offered. Marking a
    mandatory action ADVISORY hands them permission to strip a legally required control and
    makes it look like a normal editorial choice — a weakening that leaves no trace, since the
    resulting plan is internally consistent.
    """
    expected = _expected_origins(policy)
    return [
        Violation(
            "wrong_origin",
            f"'{m.actionCode}' is {expected[m.actionCode]} in the policy decision but the draft marks it {m.origin}",
        )
        for m in batch.mitigations
        if m.actionCode in expected and m.origin != expected[m.actionCode]
    ]


def _wrong_rule_reference(batch: MitigationBatch, policy: PolicyDecisionPayload) -> List[Violation]:
    """A citation pointing at the wrong rule.

    §12.2 requires a recommendation to surface the policy version and rule behind it. A
    mitigation citing a rule that did not produce it is worse than one citing none: it survives
    an audit that a blank field would fail.
    """
    expected = {a.code: a.ruleReference for a in policy.mandatoryActions + policy.advisoryActions}
    return [
        Violation(
            "wrong_rule_reference",
            f"'{m.actionCode}' came from rule {expected[m.actionCode]} but the draft cites {m.ruleReference}",
        )
        for m in batch.mitigations
        if m.actionCode in expected and m.ruleReference != expected[m.actionCode]
    ]


def _unknown_workers(batch: MitigationBatch, roster: List[str]) -> List[Violation]:
    """A worker id that is not on this shift.

    The backend intersects `appliesTo` against the shift's live assignments before dispatching,
    so an invented id cannot actually reach anyone. It is still a violation here, because a
    draft naming people who are not on the shift is one the model has stopped tracking its own
    input — and retrying is cheaper than shipping a plan whose targeting is quietly wrong.
    """
    on_shift = set(roster)
    violations: List[Violation] = []
    for m in batch.mitigations:
        for worker_id in m.appliesTo or []:
            if worker_id not in on_shift:
                violations.append(Violation(
                    "unknown_worker", f"'{m.actionCode}' targets '{worker_id}', who is not on this shift"))
    return violations


def _expected_origins(policy: PolicyDecisionPayload) -> Dict[str, str]:
    """Mandatory wins a code appearing in both lists — the stricter reading is the safe one."""
    origins = {a.code: "ADVISORY" for a in policy.advisoryActions}
    origins.update({a.code: "MANDATORY" for a in policy.mandatoryActions})
    return origins
