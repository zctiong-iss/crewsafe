# SCRUM-289 — Agent graph, supervisor draft endpoint, no-LLM fallback

Completion line for US-08. Everything through this ticket is a demonstrable, complete
"supervisor receives an explainable agent draft." Parent design:
`docs/plans/SCRUM-118-agent-design-plan.md` (read *Architecture*, *Output contract*,
*Bedrock integration*, *Model selection* before starting).

## Preconditions — do not start until all three are true

1. PR #191 (SCRUM-286, Bedrock client) merged.
2. PR #205 (SCRUM-288, extended `MitigationSuggestion` + `appliesTo` fan-out) merged.
3. SCRUM-287's PR (eval harness + model choice) merged.

Branch from fresh `origin/main` after all three. 289 consumes files from each: the
Anthropic-SDK `bedrock_client.py` (286), the six-field-richer `MitigationSuggestion.java`
and targeting-aware `fanOutDispatches` (288), and `eval_scenarios.py` /
`eval_scoring.py` / `test_agent_eval.py`'s `render_context` (287). The
`docs/plans/work-log.md` entries for 286/287/288 hold the session-by-session reasoning.

## Selected model (SCRUM-287 result)

`global.anthropic.claude-haiku-4-5-20251001-v1:0` — won the §8.6 bench on the tie-break
(latency + cost) after tying sonnet-4-5 on every ranking metric; see the committed table in
the SCRUM-118 design doc's *Model selection* section. Cross-region inference-profile ID is
mandatory: the bare `anthropic.…` form 400s on this AWS account.

## Architecture decision — hybrid split, not a pure-Python graph

The design doc draws the whole graph in `ml-service`. Deviate deliberately, and record the
deviation in the PR description:

- **Backend (Java) — `AgentDraftService`, new, in `com.crewsafe.operation.service` (or
  `mitigation.service`):** gathers all context **in-process** (it already owns every data
  service — direct method calls, no HTTP, no new auth), calls
  `PolicyEngineService.evaluateForShift(...)`, short-circuits on lightning, POSTs one rich
  payload to ml-service, validates the response, persists the `Recommendation`, writes audit.
- **ml-service (Python) — `POST /agent/draft`, new:** a LangGraph graph over only the
  uncertain part: `draft (LLM) → validate → fallback (deterministic)`.

Why: of the six data sources the agent needs, four are Java-only with **no HTTP endpoint at
all** (policy engine, shift assignments, readiness, and the weather/lightning endpoints that
do exist are per-user JWT-auth'd, unusable service-to-service). A pure Python graph means ~4
new internal endpoints plus a service-auth mechanism that doesn't exist (backend→ml-service
currently has **zero auth** — see *Risks*), plus a circular backend→python→backend call
pattern. The hybrid keeps §8.2's "policy evaluation is compulsory" guarantee *structurally*:
the ml-service payload cannot exist without a `PolicyDecision` inside it. The §8.2 "gather
context in parallel" node moves to Java; the Python graph is thinner than the doc drew it.

## Data sources — exact access paths, all verified against code

| Input | Access (from `AgentDraftService`) | Notes |
|---|---|---|
| Shift + workers + intensity + acclimatisation day | `ShiftRepository.findByIdAndSiteId`, `ShiftAssignmentRepository.findByShiftId` | Reject non-ACTIVE? For the manual trigger, allow PLANNED+ACTIVE, reject CANCELLED/CLOSED (SCRUM-255) |
| Policy decision (mandatory/advisory actions) | `PolicyEngineService.evaluateForShift(siteId, wbgt, assignments)` | Returns merged per-worker `PolicyDecision`; `policyVersion` = live `versionLabel` from DB (verified — no longer hardcoded) |
| Current WBGT + freshness + station | Weather module's service layer (what `WeatherController.getLatestWeather` calls) | `STALE` freshness → conservative advisory path per §7.1 |
| Lightning state | `LightningRiskDerivationService` (what `LightningController` calls) | Active lightning → deterministic STOP_WORK plan, **skip the LLM entirely** |
| 30/60-min forecast | ml-service `POST /forecast` — let the *Python* side call it in-graph (it's local to that service) | First real consumer of SCRUM-188; degrade to null per §7.1 if unavailable |
| Readiness submissions | `ReadinessSubmissionRepository` (in `shift/repository/`) | Context only — missing readiness must never fabricate a mandate (eval scenarios encode this) |

## Contract: backend → `POST /agent/draft` (define in this ticket, keep it boring)

Request (Pydantic model in `ml-service/models.py`):
```json
{
  "shiftId": "…", "siteId": "…",
  "currentWbgt": 31.2, "forecastWbgt30m": 32.1,
  "freshness": "LIVE", "lightningState": "CLEAR",
  "workers": [{"workerId": "…", "intensity": "HEAVY", "acclimatisationDay": 2, "readinessSubmitted": true}],
  "policyDecision": {
    "policyVersion": "MOM-WBGT-2026.1",
    "currentBand": "31_TO_BELOW_32", "forecastBand": null,
    "mandatoryActions": [{"code": "…", "ruleReference": "…", "appliesTo": ["…"], "reasoning": "…"}],
    "advisoryActions": [ ... ]
  }
}
```
Response: `{ "rationale": "…", "mitigations": [MitigationSuggestion…], "modelId": "…", "usedFallback": false, "inputTokens": n, "outputTokens": n }`
— mitigations in the full SCRUM-288 shape (`actionCode`, `category`, `origin`,
`ruleReference`, `appliesTo`, `timing`, plus prose fields).

**`rationale` is top-level and required** — mobile's detail screen renders a whole-plan
explanation paragraph prominently (`RecommendationDetailScreen`), separate from
per-mitigation rationales. The prompt must ask for both levels.

## The Python graph

`ml-service/agent/` package (design doc names this location). Nodes:

1. `draft` — promote `render_context()` from `test_agent_eval.py` (near verbatim — it
   already formats policy decisions + roster into the prompt's context block) and
   `BedrockClient.invoke()`. Size `max_tokens` from the action count like the bench does
   (`min(4096, max(1024, 400 + 300 * n_actions))`) — the 1024 default silently truncated
   every multi-worker response during benchmarking.
2. `validate` — promote the logic of `eval_scoring.py`: every `actionCode` in the allowlist
   (mirror of `ActionCatalogue`, already exists as `ALLOWED_ACTION_CODES`), every mandatory
   policy action present, `origin` correctly set. One retry of `draft` on failure, then
   `fallback`.
3. `fallback` — deterministic template straight from the policy decision, no LLM: one
   mitigation per policy action; `origin` from which list it came; prose from the action's
   `reasoning`; priority `HIGH` for mandatory / `MEDIUM` for advisory; `timing` from a fixed
   code→timing table (`REST_15_MIN_HOURLY` → `{15, 60}`, `REST_10_MIN_HOURLY` → `{10, 60}`,
   `HYDRATE_HOURLY` → `{null, 60}`); rationale assembled from band + policy version. Also
   invoked directly on Bedrock timeout/429-exhaustion. This path **will** run in real life
   (see *Risks*), it is not decorative.

Add `langgraph` to `requirements.txt` — **with real hashes** (`pip download` +
`sha256sum`); the Dockerfile enforces `--require-hashes` and there's a known pre-existing
bad `pydantic-core` hash already flagged to Surya. `pip install langgraph` into `ml_sandbox`
for local dev.

Java side re-validates defensively (`assertActionCodesAreKnown` extended to cover drafts +
a new mandatory-coverage check) — Python's validation is for retry/fallback routing; Java's
is the authoritative §8.5 gate.

## Persistence (backend, after ml-service returns)

No migration needed — `Recommendation` entity + `draft_plan TEXT` column exist; nothing has
ever written one (verified: only `RecommendationService.decide` touches the repo, and only
to update status). Write: `id`, `shiftId`, `policyVersion` (copy
`PolicyDecision.policyVersion()` — mobile cross-references it against policy records by
`versionLabel`), `draftPlan` = serialized `MitigationSuggestion.Batch`, `rationale`,
`createdAt`, and **`status = PENDING_APPROVAL` — never `DRAFT`**. Mobile's status type has
no `DRAFT` member and its status pill's fall-through logic renders `DRAFT` as a green
"Approved" — a plan nobody approved showing as approved. Landmine; stay off it.

Audit: new `AuditEventType.RECOMMENDATION_DRAFTED`, detail carrying `modelId` +
`usedFallback` (this stands in for the §12.2 evidence block until the output contract grows
one — note the partial coverage honestly in the PR).

Multiple pending recommendations per shift are allowed (matches existing SCRUM-119
behaviour; each is decided independently; the dedup guard in the design doc belongs to the
auto-trigger, which is out of scope here).

## Supervisor endpoint

`POST /api/v1/sites/{siteId}/shifts/{shiftId}/recommendations/generate` — on the existing
`RecommendationController`, same `@siteAccess` + role pattern as
`…/recommendations/{id}/decision` (SUPERVISOR/ADMIN decide; use the same for generate).
Returns the persisted `Recommendation` (201). Synchronous for MVP with the raised timeout —
a supervisor-initiated action can tolerate ~10–20 s with a loading state; async/notify is
explicitly deferred (no notification path exists in mobile anyway — it loads on
mount/pull-to-refresh only). No frontend currently references a generate endpoint (verified
across mobile + web), so the shape is unconstrained.

## Config fixes — do these first, nothing works without them

In `application.yml` (`app.bedrock`) and `BedrockProperties` defaults:

| Key | Today | Needed | Why |
|---|---|---|---|
| `bedrock-timeout-ms` | 5000 | 30000 | Measured p95 for haiku-4-5 is **10.4 s** (sonnet-4-5: 16.4 s); at 5 s the LLM path fails 100% of the time and every request silently falls back |
| `max-tokens` | 1024 | 4096 | 1024 truncated every multi-worker plan into schema-invalid output during the bench |
| `model-id` | `anthropic.claude-3-5-sonnet-20241022-v2:0` | `global.anthropic.claude-haiku-4-5-20251001-v1:0` | Bare ID 400s on this account; and it's not the selected model |

(The `crewsafe.bedrock`→`app.bedrock` prefix bug is already fixed on main.)

## Risks / known constraints

- **Throttling is real.** This account 429s under modest burst despite huge token quotas
  (request-rate cap, not token cap — measured repeatedly during benchmarking).
  `BedrockClient` already has `max_retries=8`; on exhaustion the graph must land in
  `fallback`, not surface a 500.
- **No auth between backend and ml-service.** Pre-existing, fine on localhost, must be
  flagged in the PR as a deployment security follow-up — do not silently ship it.
- **Web has no recommendation UI at all** (`web/src/features/` = conditions/home/
  placeholder/shifts). The design doc's end-to-end demo line says "supervisor approves in
  web" — the demo must say *mobile*, or someone builds a web surface. Surface this to the
  team; not this ticket's scope.
- **Mobile won't auto-show a new draft** — pull-to-refresh only. Demo script: generate,
  then pull down.
- Env: conda env `ml_sandbox`, `AWS_PROFILE=crewsafe`, backend needs
  `JAVA_HOME=/Users/abu/Library/Java/JavaVirtualMachines/ms-21.0.11/Contents/Home` for
  `./mvnw` (repo needs 21; shell default is 17). `mvnw` lives in `backend/`, not the root.

## Verification (from the design doc's own list)

- Unknown action code from the model → draft discarded, deterministic fallback persisted (AT-11).
- Mandatory action omitted → same.
- Bedrock timeout / throttle-exhaustion → fallback, request still 201s.
- Lightning `LIGHTNING` → STOP_WORK plan persisted without any LLM call.
- `STALE` freshness → conservative advisory plan, not a normal one.
- Happy path: `POST …/generate` → 201 `PENDING_APPROVAL` → decide via existing endpoint →
  `fanOutDispatches` targets per `appliesTo` (SCRUM-288's tests already cover the fan-out half).
- Full backend suite green (447 at last count) + ml-service pytest green.
- One live end-to-end against real Bedrock before the PR — mocked tests missed the
  inference-profile bug once already this sprint (SCRUM-286 work-log entry).

## Out of scope, deliberately

Auto-trigger on band change (phase 6), Ramadan mode (7), LangSmith (8), web approval UI,
push/notify on new draft, backend↔ml-service auth. US-08 is complete without all of them.
