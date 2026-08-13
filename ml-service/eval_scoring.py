"""§8.6 scoring: grade a model's MitigationBatch against a scenario's ground truth.

Six functions, matching §8.6's metric list exactly. Each returns a float in [0, 1] where
1.0 is perfect — except unsupported_action_rate, where 0.0 is the passing value (§8.6:
"unsupported action rate must be zero in the final evaluation set").

One naming note: §8.6 says "approval-required classification" without defining it further.
Read against §8.1's boundary ("the agent must never omit or weaken a mandatory action") and
the output contract's `origin` field (MANDATORY = a supervisor may not remove it, ADVISORY =
they may), the natural reading is: did the model correctly classify each action's origin?
Getting this backwards would let a supervisor believe a required action was optional and
silently strip it — the exact failure §8.1 exists to prevent. Documented here since §8.6
itself doesn't spell it out.
"""
from typing import List
from models import MitigationBatch, MitigationSuggestion
from eval_scenarios import ExpectedAction

# Mirrors backend/src/main/java/com/crewsafe/policy/domain/PolicyActionCode.java exactly.
ALLOWED_ACTION_CODES = {
    "STOP_WORK", "RESUME_WORK", "REST_10_MIN_HOURLY", "REST_15_MIN_HOURLY",
    "HYDRATE_HOURLY", "HYDRATE_REGULARLY", "SHADE_RECOVERY",
    "RESCHEDULE_HEAVY_WORK", "ROTATE_TO_LIGHT_DUTY", "CLOSE_MONITORING",
}


def unsupported_action_rate(batch: MitigationBatch) -> float:
    """Fraction of the model's action codes that aren't in the allowlist. The §8.6 gate:
    must be exactly 0.0, or the model is disqualified regardless of every other score."""
    if not batch.mitigations:
        return 0.0
    unsupported = sum(1 for m in batch.mitigations if m.actionCode not in ALLOWED_ACTION_CODES)
    return unsupported / len(batch.mitigations)


def mandatory_action_recall(batch: MitigationBatch, mandatory: List[ExpectedAction]) -> float:
    """Of the policy engine's mandatory actions, what fraction did the model actually
    include? Silently dropping a mandatory action is the worst failure mode this system
    has (§8.5: "a plan missing a policy reference cannot be approved")."""
    if not mandatory:
        return 1.0  # nothing was required, so nothing to have missed
    produced_codes = {m.actionCode for m in batch.mitigations}
    hits = sum(1 for a in mandatory if a.action_code in produced_codes)
    return hits / len(mandatory)


def policy_citation_accuracy(
    batch: MitigationBatch, mandatory: List[ExpectedAction], advisory: List[ExpectedAction]
) -> float:
    """Of the model's mitigations whose actionCode matches a real expected action, what
    fraction cite the SAME ruleReference the policy engine actually used? Only checked
    against codes present in both — an unsupported code is already penalised by
    unsupported_action_rate, a missing one by recall, so this isn't double-counting them."""
    expected_by_code = {a.action_code: a.rule_reference for a in mandatory + advisory}
    checkable = [m for m in batch.mitigations if m.actionCode in expected_by_code]
    if not checkable:
        return 1.0
    correct = sum(1 for m in checkable if m.ruleReference == expected_by_code[m.actionCode])
    return correct / len(checkable)


def affected_worker_accuracy(
    batch: MitigationBatch, mandatory: List[ExpectedAction], advisory: List[ExpectedAction]
) -> float:
    """Of the model's mitigations whose actionCode matches a real expected action, did it
    name the right workers? appliesTo omitted counts as 'applies to everyone this action
    covers', per the SCRUM-288 whole-shift convention."""
    expected_by_code = {a.action_code: set(a.applies_to) for a in mandatory + advisory}
    checkable = [m for m in batch.mitigations if m.actionCode in expected_by_code]
    if not checkable:
        return 1.0
    correct = 0
    for m in checkable:
        expected_workers = expected_by_code[m.actionCode]
        actual_workers = set(m.appliesTo) if m.appliesTo is not None else expected_workers
        if actual_workers == expected_workers:
            correct += 1
    return correct / len(checkable)


def approval_classification_accuracy(
    batch: MitigationBatch, mandatory: List[ExpectedAction], advisory: List[ExpectedAction]
) -> float:
    """Of the model's mitigations whose actionCode matches a real expected action, did it
    correctly mark origin as MANDATORY vs ADVISORY? See module docstring for why this is
    the reading of §8.6's "approval-required classification" used here."""
    expected_origin = {a.action_code: "MANDATORY" for a in mandatory}
    expected_origin.update({a.action_code: "ADVISORY" for a in advisory})
    checkable = [m for m in batch.mitigations if m.actionCode in expected_origin]
    if not checkable:
        return 1.0
    correct = sum(1 for m in checkable if m.origin == expected_origin[m.actionCode])
    return correct / len(checkable)


def explanation_completeness(batch: MitigationBatch) -> float:
    """Fraction of mitigations carrying real, non-placeholder rationale/action/estimatedImpact
    text — a mitigation a supervisor can't understand is one they can't safely approve."""
    if not batch.mitigations:
        return 0.0

    def is_complete(m: MitigationSuggestion) -> bool:
        return all(len(getattr(m, f).strip()) >= 10 for f in ("action", "rationale", "estimatedImpact"))

    complete = sum(1 for m in batch.mitigations if is_complete(m))
    return complete / len(batch.mitigations)
