"""§8.6 model bench: run every candidate model against the fixed evaluation set, score each
against the six §8.6 metrics, and apply the decision rule fixed in the SCRUM-118 design doc
before any run:

  1. Gate  — unsupported-action rate must be zero; anything else is disqualified outright.
  2. Rank  — mandatory-action recall, then policy-citation accuracy, then affected-worker
             accuracy.
  3. Tie-break — p95 latency, then measured cost (derived from real input/output token counts).

stale_data and lightning_override scenarios are excluded from the numeric comparison — their
correct answer isn't expected_policy_decision()'s output (see eval_scenarios.py docstring),
and scoring them against it would penalise a model for correctly overriding the WBGT-derived
list. They still run, for manual/qualitative inspection, just not folded into the ranking.

Run directly for the full bench: `python test_agent_eval.py`
Run via pytest for the CI-friendly gate check on a small scenario subset: `pytest test_agent_eval.py`
"""
import statistics
import time
from typing import Dict, List

from agent.context import render_context
from agent.contract import AgentDraftRequest, PolicyActionPayload, PolicyDecisionPayload, WorkerContext
from bedrock_client import BedrockClient
from eval_scenarios import SCENARIOS, EvalScenario, ExpectedAction, expected_policy_decision
from eval_scoring import (
    unsupported_action_rate, mandatory_action_recall, policy_citation_accuracy,
    affected_worker_accuracy, approval_classification_accuracy, explanation_completeness,
)

# Anthropic models enabled in this account/region (aws bedrock list-foundation-models
# --region ap-southeast-1 --by-provider anthropic), using their cross-region inference
# profile IDs (aws bedrock list-inference-profiles) since on-demand invocation isn't
# supported for current-generation models here — same issue SCRUM-286 hit and documented.
#
# list-foundation-models lists what the REGION offers, not what this ACCOUNT has Marketplace
# access to (access is granted per-model, per the design doc's own "Model selection" section).
# Cross-checked against this account's actual Service Quotas page (Bedrock > Service quotas,
# filtered to "tokens per minute for Anthropic Claude"): claude-sonnet-5, claude-opus-5,
# claude-opus-4-7, claude-opus-4-8 and claude-fable-5 all show a quota of exactly 0 — genuinely
# disabled for this account, not just unlisted, which is what the earlier 403s were. Every
# model below has a real, nonzero quota on that page. claude-sonnet-4-20250514 is the one
# exception: it has a quota but 404s live ("Legacy" model deactivated after 30 days unused).
CANDIDATE_MODELS = [
    "global.anthropic.claude-haiku-4-5-20251001-v1:0",     # 5,000,000 TPM
    "apac.anthropic.claude-3-5-sonnet-20241022-v2:0",      # 800,000 TPM; current hardcoded default, kept as baseline
    "global.anthropic.claude-sonnet-4-5-20250929-v1:0",    # 5,000,000 TPM
    "global.anthropic.claude-sonnet-4-6",                  # 6,000,000 TPM — most generous quota on the account
    "global.anthropic.claude-opus-4-5-20251101-v1:0",      # 2,000,000 TPM
    "global.anthropic.claude-opus-4-6-v1",                 # 3,000,000 TPM
]

# This account/region enforces a request-burst limit tighter than its stated tokens-per-minute
# quota (confirmed live: claude-3-5-sonnet-v2 has an 800k TPM budget, our calls use ~2.5k
# tokens each — nowhere near enough to explain the throttling seen). Even with max_retries=8
# and 4s of explicit spacing, apac.anthropic.claude-3-5-sonnet-20241022-v2:0 (the older,
# region-pinned inference profile, as opposed to the newer "global." ones) alternated
# success/429/success/429 — consistent with a requests-per-minute cap well under what its
# token quota alone would suggest, and not shown in the AWS console's per-model quota list
# (which only surfaces token-based quotas). 15s of spacing is a safety margin above the
# ~20-40s gap observed between successful calls to that specific model.
REQUEST_SPACING_SECONDS = 15

# Per-million-token list prices, by model tier, used for the design doc's final tie-break
# ("p95 latency, then measured cost per run"). The bench counted real tokens from day one but
# never priced them, so that tie-break was unimplemented until now.
#
# These are Anthropic's first-party API rates (input, output). Bedrock is partner-operated and
# bills at its own rates — the ABSOLUTE figures below are therefore indicative, not what this
# account is invoiced. The RELATIVE ordering (Haiku < Sonnet < Opus, ~1x / 3x / 5x) is what the
# tie-break actually turns on, and that ordering holds on Bedrock too.
PRICE_PER_MTOK = {
    "haiku": (1.0, 5.0),
    "sonnet": (3.0, 15.0),
    "opus": (5.0, 25.0),
}


def _tier(model_id: str) -> str:
    for tier in ("haiku", "opus", "sonnet"):
        if tier in model_id:
            return tier
    raise ValueError(f"no known price tier for {model_id}")


def cost_per_run_usd(model_id: str, avg_input_tokens: float, avg_output_tokens: float) -> float:
    """Mean USD cost of one scenario for this model, from its real measured token counts."""
    in_price, out_price = PRICE_PER_MTOK[_tier(model_id)]
    return (avg_input_tokens / 1e6) * in_price + (avg_output_tokens / 1e6) * out_price


SPECIAL_CASED_COVERAGE = {"stale_data", "lightning_override"}
RANKED_SCENARIOS = [s for s in SCENARIOS if s.coverage not in SPECIAL_CASED_COVERAGE]

# Small, fast subset for CI / iteration — one scenario per coverage bucket.
SMOKE_SCENARIOS = list({s.coverage: s for s in SCENARIOS}.values())


# The MOM policy version PolicyEngineServiceTest.java configures, and therefore the one
# expected_policy_decision()'s thresholds were ported from.
BENCH_POLICY_VERSION = "MOM-WBGT-2026.1"

# eval_scenarios.py predates the backend's LightningRiskState and uses its own words. The
# contract has to speak the backend's, so the adapter translates rather than either side
# bending: WARNING is the state where a strike is near but work continues (ADVISORY), LIGHTNING
# is the state where it does not (STOP_WORK).
LIGHTNING_STATE_BY_SCENARIO_WORD = {"CLEAR": "CLEAR", "WARNING": "ADVISORY", "LIGHTNING": "STOP_WORK"}


def _classify_band(wbgt: float) -> str:
    """Mirrors com.crewsafe.weather.domain.WbgtBand.classify, including its half-open
    boundaries (exactly 32.0 is 32_TO_BELOW_33). In production the band arrives from Java on
    the request; the bench has no Java, so it classifies here."""
    if wbgt >= 33:
        return "33_AND_ABOVE"
    if wbgt >= 32:
        return "32_TO_BELOW_33"
    if wbgt >= 31:
        return "31_TO_BELOW_32"
    return "BELOW_31"


def to_draft_request(
    scenario: EvalScenario, mandatory: List[ExpectedAction], advisory: List[ExpectedAction]
) -> AgentDraftRequest:
    """Dress a scenario up as the request the backend would really send.

    This adapter is the whole point of the SCRUM-289 promotion. `render_context` now lives in
    `agent/context.py` and is called by production; the bench reaches it through this
    conversion instead of keeping its own copy. A model was selected on the strength of prompts
    built by that function, so the benchmark measuring a *different* prompt-builder than the one
    that ships would quietly invalidate the selection.

    `readinessSubmitted` is True for every worker on purpose: the missing_readiness scenarios
    express the gap through their own `notes` text, and letting the renderer synthesise a second
    readiness sentence on top would change those prompts rather than preserve them.
    """
    return AgentDraftRequest(
        shiftId=scenario.id,
        siteId="bench",
        currentWbgt=scenario.current_wbgt,
        forecastWbgt30m=scenario.forecast_wbgt,
        freshness=scenario.freshness,
        lightningState=LIGHTNING_STATE_BY_SCENARIO_WORD[scenario.lightning_state],
        workers=[
            WorkerContext(
                workerId=w.worker_id,
                intensity=w.intensity,
                acclimatisationDay=w.acclimatisation_day,
                readinessSubmitted=True,
            )
            for w in scenario.workers
        ],
        contextNotes=[scenario.notes] if scenario.notes else [],
        policyDecision=PolicyDecisionPayload(
            policyVersion=BENCH_POLICY_VERSION,
            currentBand=_classify_band(scenario.current_wbgt),
            forecastBand=(_classify_band(scenario.forecast_wbgt)
                          if scenario.forecast_wbgt is not None else None),
            mandatoryActions=[_to_policy_action(a) for a in mandatory],
            advisoryActions=[_to_policy_action(a) for a in advisory],
        ),
    )


def _to_policy_action(action: ExpectedAction) -> PolicyActionPayload:
    return PolicyActionPayload(
        code=action.action_code,
        ruleReference=action.rule_reference,
        appliesTo=list(action.applies_to),
        reasoning=f"Policy engine decided {action.action_code} under rule {action.rule_reference}",
    )


def run_bench(model_ids: List[str], scenarios: List[EvalScenario]) -> Dict[str, dict]:
    """Runs every model against every scenario, scores each response, and returns per-model
    aggregate metrics plus per-scenario failures for inspection."""
    results: Dict[str, dict] = {}

    for model_idx, model_id in enumerate(model_ids):
        if model_idx > 0:
            time.sleep(REQUEST_SPACING_SECONDS)
        client = BedrockClient()
        metrics = {
            "unsupported_action_rate": [], "mandatory_action_recall": [],
            "policy_citation_accuracy": [], "affected_worker_accuracy": [],
            "approval_classification_accuracy": [], "explanation_completeness": [],
        }
        latencies_ms, input_tokens, output_tokens = [], [], []
        failures = []

        for i, scenario in enumerate(scenarios):
            if i > 0:
                time.sleep(REQUEST_SPACING_SECONDS)
            mandatory, advisory = expected_policy_decision(scenario.current_wbgt, scenario.workers)
            context = render_context(to_draft_request(scenario, mandatory, advisory))
            # invoke()'s 1024-token default silently truncates multi-mitigation responses —
            # found live: an 8-mitigation scenario (3 workers) needed 1508 output tokens and
            # came back as an empty, schema-invalid tool call at the default cap. Size the
            # budget to the number of mitigations actually expected, floored at the old
            # default so simple scenarios are unaffected, capped at MitigationRequest's own
            # documented ceiling (models.py).
            expected_count = max(1, len(mandatory) + len(advisory))
            max_tokens = min(4096, max(1024, 400 + 300 * expected_count))
            try:
                batch, latency_ms, in_tok, out_tok = client.invoke(
                    context=context, model_id=model_id, max_tokens=max_tokens)
            except Exception as e:
                failures.append((scenario.id, str(e)))
                continue

            latencies_ms.append(latency_ms)
            input_tokens.append(in_tok)
            output_tokens.append(out_tok)
            metrics["unsupported_action_rate"].append(unsupported_action_rate(batch))
            metrics["mandatory_action_recall"].append(mandatory_action_recall(batch, mandatory))
            metrics["policy_citation_accuracy"].append(policy_citation_accuracy(batch, mandatory, advisory))
            metrics["affected_worker_accuracy"].append(affected_worker_accuracy(batch, mandatory, advisory))
            metrics["approval_classification_accuracy"].append(
                approval_classification_accuracy(batch, mandatory, advisory))
            metrics["explanation_completeness"].append(explanation_completeness(batch))

        n = len(latencies_ms)
        results[model_id] = {
            "n_scenarios": n,
            "failures": failures,
            **{k: (sum(v) / len(v) if v else None) for k, v in metrics.items()},
            "p95_latency_ms": (statistics.quantiles(latencies_ms, n=20)[18] if n >= 2 else
                                (latencies_ms[0] if n == 1 else None)),
            "avg_input_tokens": (sum(input_tokens) / n if n else None),
            "avg_output_tokens": (sum(output_tokens) / n if n else None),
        }

    return results


def apply_decision_rule(results: Dict[str, dict]) -> List[str]:
    """§8.6 decision rule: gate on zero unsupported-action rate, rank by
    (mandatory_recall, citation_accuracy, worker_accuracy) descending, tie-break on
    (p95 latency, avg total tokens as a cost proxy) ascending. Returns model IDs ranked
    best-first; disqualified models are dropped entirely."""
    passing = {m: r for m, r in results.items() if r["unsupported_action_rate"] == 0.0 and r["n_scenarios"] > 0}
    return sorted(
        passing,
        key=lambda m: (
            -passing[m]["mandatory_action_recall"],
            -passing[m]["policy_citation_accuracy"],
            -passing[m]["affected_worker_accuracy"],
            passing[m]["p95_latency_ms"] or float("inf"),
            (passing[m]["avg_input_tokens"] or 0) + (passing[m]["avg_output_tokens"] or 0),
        ),
    )


def print_table(results: Dict[str, dict]) -> None:
    cols = ["unsupported_action_rate", "mandatory_action_recall", "policy_citation_accuracy",
            "affected_worker_accuracy", "approval_classification_accuracy",
            "explanation_completeness", "p95_latency_ms", "avg_input_tokens", "avg_output_tokens"]
    print(f"{'model':45s}" + "".join(f"{c[:14]:>16s}" for c in cols))
    for model_id, r in results.items():
        row = "".join(
            f"{(f'{r[c]:.2f}' if isinstance(r[c], float) else str(r[c])):>16s}" for c in cols
        )
        print(f"{model_id:45s}{row}  (n={r['n_scenarios']}, failures={len(r['failures'])})")


def test_gate_zero_unsupported_action_rate():
    """CI-friendly smoke check on one scenario per coverage bucket — proves the harness and
    every enabled model stay inside the allowlist. The full 35-scenario / all-metric ranking
    run is `python test_agent_eval.py`, not part of the automated suite (it's a live,
    billed Bedrock call per model per scenario)."""
    results = run_bench(CANDIDATE_MODELS, SMOKE_SCENARIOS)
    for model_id, r in results.items():
        assert r["n_scenarios"] > 0, f"{model_id} produced no successful responses: {r['failures']}"
        assert r["unsupported_action_rate"] == 0.0, f"{model_id} invented an action code: {r['failures']}"


if __name__ == "__main__":
    results = run_bench(CANDIDATE_MODELS, RANKED_SCENARIOS)
    print_table(results)
    ranked = apply_decision_rule(results)
    print()
    print("Ranked (best first), gate-passing only:", ranked or "NONE PASSED THE GATE")
