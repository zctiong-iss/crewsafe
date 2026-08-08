# SCRUM-118 — Agentic AI: draft-plan generation, output contract and model selection

## Outcome

The pipeline gains its missing middle. Today a heat event produces a stored weather
observation and nothing else; `recommendation` and `approval` have existed as tables since
`V3__domain_schema.sql` with no code that writes to them. This ticket adds the agent that
drafts a `Recommendation` from live conditions, deterministic policy output and shift
context — leaving SCRUM-119's approve/edit/reject and SCRUM-193's dispatch fan-out to carry
it the rest of the way to a worker's phone.

It also settles the output contract the web and mobile teams are blocked on, and picks the
foundation model by measurement rather than assumption.

Delivers US-08 (*"As a supervisor, I receive an explainable agent draft"*, 8 pts, Sprint 2)
and the Sprint 2 exit criterion *"agent cannot dispatch without approval."*

## Starting-state correction

When this ticket was scoped, three open PRs implemented overlapping parts of the same
pipeline against three different contracts:

| PR | Ticket | Contents | State |
|---|---|---|---|
| [#60](https://github.com/zctiong-iss/crewsafe/pull/60) | SCRUM-119 | Approve/edit/reject on the existing `recommendation`/`approval` tables; introduces `docs/api/recommendation.yaml` | Approved, open |
| [#126](https://github.com/zctiong-iss/crewsafe/pull/126) | SCRUM-117 | `com.crewsafe.policy` module, `heat_rest_policy` table | **Merged 2026-08-08** |
| [#127](https://github.com/zctiong-iss/crewsafe/pull/127) | SCRUM-118 | `agent_draft_plans` table, six endpoints under `/api/supervisor/agent-plans` | Open — superseded, see *Reconciliation* |

Two problems were found and both are now resolved in #126:

- **Duplicate `V8`.** PR #124 (`V8__shift_cancelled_status.sql`) and PR #126
  (`V8__heat_rest_policy.sql`) both claimed it. Integration tests run against real
  PostgreSQL 16 via Testcontainers with `baseline-on-migrate: false` and
  `ddl-auto: validate`, so whichever merged second would have failed outright — the same
  failure mode as the SCRUM-255 renumber (`aeeb06e`). #126 renumbered to `V9`.
- **Policy output contract.** `PolicyDecision` originally returned
  `{Action, RestRecommendation, reasoning}`, which carried no policy version and no rule
  references, making FR-16 unsatisfiable downstream. Commit `3b6c36c` refactored it to carry
  `policyVersion`, both bands, and a required/advised split.

**Consequence for `V8`.** `main` now runs `V1–V7, V9` with a gap. Flyway's `outOfOrder`
setting is not configured anywhere in the repo, so it defaults to `false`: a fresh database
applies `V8` then `V9` happily, but any database that has *already* applied `V9` — staging,
or a developer's local DB pulled after 2026-08-08 — will fail validation when a new `V8`
appears beneath it. **PR #124 must renumber `V8__shift_cancelled_status.sql` to `V10`.** It
is the only open PR carrying a migration.

This was a contract-agreement gap rather than a code-quality problem — see *Reconciliation*
for what carried forward from each PR.

## Reconciliation

### Carried forward from PR #126 (SCRUM-117 policy engine)

Kept as-is: `heat_rest_policy`, `AcclimatisationCalculator`, `PolicyConfigRepository`, the
per-site configurable threshold approach, and the existing 33 tests. Making thresholds
configuration rather than constants is the right call and matches the project plan's
requirement that *"all thresholds are configuration records, not hard-coded in UI or
prompts"* (§7.1).

**The output-contract change landed in `3b6c36c` before merge.** `PolicyDecision` on `main`
now reads:

```java
record PolicyDecision(
    String policyVersion, String currentBand, String forecastBand,
    List<PolicyAction> required, List<PolicyAction> advised)
record PolicyAction(String action, String ruleReference, List<String> appliesTo, String reasoning)
```

That carries everything FR-16 needs, plus `appliesTo[]` for the per-worker targeting shift
rotation requires (and which closes SCRUM-243). Thresholds were also moved to `BigDecimal`
in `0278317`, matching the precision convention the weather module already uses.

**Three residual deltas to settle before anything serialises this record.** None block the
agent, which consumes `PolicyDecision` internally and emits its own `Recommendation` shape —
but they matter the moment a policy endpoint exists:

| Here | Mobile's `PolicyEvaluation` ([`domain.ts:168`](../../mobile/src/types/domain.ts)) |
|---|---|
| `required` / `advised` | `mandatoryActions` / `advisoryActions` |
| `PolicyAction.action` | `PolicyAction.code` |
| `currentBand` / `forecastBand` as `String` | `WbgtBand` union type |

Also: `forecastBand` is `Objects.requireNonNull`, but mobile types it `WbgtBand | null`. If
the forecast service is unavailable or a site has no forecast yet, a `PolicyDecision` cannot
be constructed at all. Worth relaxing to nullable, since §7.1's stale-data rule expects the
system to degrade rather than fail.

Band derivation should reuse `weather/domain/WbgtBand.classify()` rather than recompute — it
is on `main` with 13 boundary tests and a deliberate half-open, null-safe design (`32.0` is
`32_TO_BELOW_33`; a null WBGT yields a null band, never `BELOW_31`).

Still open: the 3-level acclimatisation model (days 1–3 / 4–6 / 7+) against
`shift_assignment.acclimatisation_day INTEGER CHECK (BETWEEN 1 AND 7)` and §7.1's seven-day
ramp. Cheapest fix is to keep the levels as a derived view over the day number.

### Carried forward from PR #127 (SCRUM-118 agent draft)

Kept as design input: recording `policyRulesApplied`, `forecastDataUsed`, `modelId` and
`modelVersion` — correct instinct for FR-16 and §12.2, and folded into the `evidence` block
below. The 5-second Bedrock timeout is kept.

**Not carried forward: the `agent_draft_plans` table and its approve/reject endpoints.**
Four properties of that schema block requirements this ticket has to meet:

| Schema property | Consequence |
|---|---|
| `site_id`, no `shift_id` | No join path to `shift_assignment`, so no per-worker targeting, no task intensity, no acclimatisation day. §8.6's "correct affected-worker selection" metric becomes unmeasurable. |
| `recommended_actions TEXT` | Free prose cannot be validated against an action allowlist. That allowlist is the primary guardrail in §8.5 and §19.3. |
| `approval_status` on the draft row | Approving mutates the draft, so FR-20 ("preserve both the agent draft and approved version") is lost. No `EDITED` state, so FR-19 is partial. |
| No `approval` row written | `ActionDispatchService.dispatchAction` takes an `approvalId` and loads the `Approval` before doing anything else. With no such row there is nothing to pass it, so an approved plan on this table can never reach a worker — regardless of which decision values the check allows (`main` requires `APPROVED`; PR #60 widens it to "not `REJECTED`" so an `EDITED` plan also dispatches). |

The last row is decisive and checkable in a minute against
[`ActionDispatchService`](../../backend/src/main/java/com/crewsafe/operation/service/ActionDispatchService.java).

The agent therefore writes to the existing `recommendation`/`approval` tables, which are
already wired to dispatch and already have approve/edit/reject in PR #60.

### Merge order

Each contributor's work stays in their own PR — no absorbing another branch's code, so
authorship and the individual contribution report stay accurate.

| # | PR | Action | State |
|---|---|---|---|
| 1 | #126 | Renumber to `V9`, apply the output change, move status docs to `docs/plans/` | ✅ Merged 2026-08-08 |
| 2 | #112, #125 | Rebase and merge — no migrations | Pending |
| 3 | #124 | **Renumber `V8` → `V10`** (see *Starting-state correction*), then rebase and merge | Pending |
| 4 | #60 | Rebase and merge — already approved; provides the recommendation/approval API | Pending |
| 5 | #127 | Close rather than merge — merging the table and later dropping it costs an extra migration | Pending |

Backend CI is green on `main` at the #126 merge commit (`c82485d`). The Security Scan
workflow is failing on `main`, but on the `SAST (SonarQube)` and `Sonar Security Hub Import`
jobs only — `Gate Self-Tests` and `Secret Scan` pass. That is the tooling issue PR #133 was
opened to address, not a defect introduced by #126.

### Ownership

| Surya | Abu |
|---|---|
| PR #126 policy engine + the §7.2 output change | The agent: graph, Bedrock integration, prompt, validation |
| Rule catalogue content and thresholds | Output contract + action-code allowlist |
| Forecast model (SCRUM-114) | Model selection + the §8.6 evaluation set |

## Approved design

### The boundary

> The deterministic policy engine decides **what is required**. The agent decides **how to
> phrase it, who it applies to, and in what order** — and explains why.

This is §8.1 restated, and it is the load-bearing constraint. §4.3 lists *"an unrestricted
chatbot that improvises safety advice"* as an explicit product exclusion; §7 opens with
*"the policy engine — not the LLM — is the source of required action logic."*

| The agent does | The agent must never |
|---|---|
| Gather site, shift, worker, weather and forecast context | Emit an action code outside the allowlist |
| Call the policy engine and treat its output as authoritative | Omit or weaken a mandatory action |
| Target actions at specific workers | Alter a shift assignment |
| Prioritise and sequence | Dispatch without supervisor approval |
| Write plain-language rationale citing the matched rule | Infer worker health or vulnerability |

### Output contract

**One JSON body per recommendation, not one per topic.** A recommendation is decided as a
unit: `approval.recommendation_id` is a UNIQUE 1:1 FK and PR #60 returns 409 on a second
decision. Splitting by topic would require N approvals for one weather event.

**Topic separation is a `category` field per mitigation**, grouped client-side.

| `category` | Action codes |
|---|---|
| `STOP_WORK` | `STOP_WORK_LIGHTNING`, `SEEK_SHELTER` |
| `REST` | `REST_10_MIN_HOURLY`, `REST_15_MIN_HOURLY` |
| `HYDRATION` | `HYDRATE_HOURLY` |
| `SHADE_COOLING` | `SHADE_RECOVERY` |
| `WORK_SCHEDULING` | `RESCHEDULE_HEAVY_WORK`, `ROTATE_TO_LIGHT_DUTY` |
| `ACCLIMATISATION` | `ACCLIMATISATION_RESTRICT` |
| `MONITORING` | `MONITOR_VULNERABLE`, `CLOSE_MONITORING` |
| `FASTING_ADJUSTMENT` | Reserved — see *Feature scope* |

`actionCode` is validated server-side against a fixed allowlist before persistence. A draft
containing an unknown code is rejected wholesale. This single check discharges §8.5 (*"a plan
with an unknown action code cannot be saved"*) and the §22 item *"action allowlist is
enforced server-side"*, and is the mechanism behind §8.6's requirement that unsupported-action
rate be zero.

**Dynamic values are typed fields, never prose.** Clients must not parse `action` text to
recover a number — mobile ships seven locales (SCRUM-205) and a regex over translated text
works in English and fails in the other six, exactly as documented for the rest timer in
SCRUM-206.

| Field | Example | Varies with |
|---|---|---|
| `timing.durationMinutes` | `15` | 10 min at WBGT 32, 15 at 33 |
| `timing.everyMinutes` | `60` | Recurrence |
| `timing.startByUtc` | ISO 8601 | Deadline |
| `appliesTo[]` | worker UUIDs | Task intensity, acclimatisation day |
| `priority` | `HIGH` | Ordering |
| `origin` | `MANDATORY` / `ADVISORY` | What a supervisor may not remove |
| `ruleReference` | `HS-33-HEAVY` | FR-16 |

```json
{
  "id": "…", "shiftId": "…", "siteId": "…",
  "status": "PENDING_APPROVAL",
  "createdAt": "2026-08-08T06:15:00Z",
  "trigger": { "type": "BAND_CHANGE", "detail": "32_TO_BELOW_33 → 33_AND_ABOVE" },

  "evidence": {
    "policyVersion": "MOM-WBGT-2026.1",
    "modelVersion": "baseline-1.0.0",
    "observedWbgt": 32.4, "forecastWbgt30m": 33.1,
    "currentBand": "32_TO_BELOW_33", "forecastBand": "33_AND_ABOVE",
    "observedAt": "…", "freshness": "LIVE", "source": "NEA", "stationId": "S128",
    "lightningState": "CLEAR"
  },

  "rationale": "Forecast crosses into the 33°C band within 30 minutes…",

  "mitigations": [
    {
      "actionCode": "REST_15_MIN_HOURLY",
      "category": "REST",
      "priority": "HIGH",
      "origin": "MANDATORY",
      "appliesTo": ["w-1", "w-3"],
      "ruleReference": "HS-33-HEAVY",
      "timing": { "durationMinutes": 15, "everyMinutes": 60, "startByUtc": "…" },
      "action": "Rest 15 minutes in shade every hour",
      "rationale": "Forecast WBGT reaches 33.1°C within 30 minutes on heavy tasks",
      "estimatedImpact": "Keeps core temperature within MOM guidance"
    }
  ],

  "approval": null
}
```

`evidence` satisfies §12.2 (*"every recommendation returns policyVersion, modelVersion,
matchedRules and approvalStatus"*) and §19.2's requirement to always surface data age, model
version and policy version.

**Extension is additive and needs no migration.** `recommendation.draft_plan` is `TEXT`
holding a Jackson-serialised `MitigationSuggestion.Batch` (see `RecommendationService
.serializePlan`), so the new fields are a payload change. Add
`@JsonIgnoreProperties(ignoreUnknown = true)` for rows written before the extension.

**Dispatch code mapping — required.** Two catalogues exist and differ:

- Recommendation/policy codes: `REST_15_MIN_HOURLY`, `HYDRATE_HOURLY`
- Dispatch codes mobile consumes: `REST_15_MIN`, `HYDRATE`, `STOP_WORK`, `ROTATE_TO_LIGHT_DUTY`

Mobile's rest timer extracts the duration from `actionCode` with `REST_(\d+)_MIN`
(SCRUM-206). Emitting the `_HOURLY` form directly into `action_dispatch` risks a partial
match. Fan-out therefore maps the code and carries recurrence in `timing`:
`REST_15_MIN_HOURLY` → dispatch `REST_15_MIN` + `everyMinutes: 60`.

This replaces SCRUM-193's `AI_RECOMMENDED_ACTION` placeholder — which made every AI-sourced
dispatch render identically — and requires **no mobile changes**: the existing timer,
auto-dismiss (SCRUM-207) and pictogram paths start working on AI-sourced dispatches as-is.

### Data sources

The heat-stress core requires no new external feed.

| Required | Source | State |
|---|---|---|
| WBGT, temperature, humidity, wind, rainfall | `weather_observation`, 15-min NEA ingest | Live |
| Freshness, source, station | Derived at read time (`WeatherFreshnessClassifier`) | Live |
| WBGT band | `WbgtBand.classify()` | Live |
| Lightning risk state | `LightningRiskDerivationService` | Live |
| Workers, task, intensity, acclimatisation day | `shift`, `shift_assignment` | Live |
| Readiness flags and symptoms | `readiness_submission` | Live |
| 30/60-min forecast | `ml-service` `POST /forecast` | Built (SCRUM-188), **not yet consumed** |
| Mandatory/advisory actions | Policy engine | PR #126 + output change |
| Weather history over HTTP | Retained indefinitely; only `/weather/latest` is exposed | Add a range endpoint if trend reasoning is wanted |
| PSI / air quality | Absent from the codebase | Out of scope — see *Feature scope* |

The agent is the forecast service's first consumer, which also gives SCRUM-114's trained
model a live integration point.

### Architecture

A **LangGraph state graph**, not a free-running tool-calling agent. §8.2 specifies a fixed
sequence in which calling the policy engine is compulsory; a model-driven tool loop cannot
guarantee a given tool is invoked, whereas a state graph makes it a structural edge. This is
the difference between asking the model to cite policy and making a plan without policy
references impossible to construct.

```
trigger (band change | supervisor request)
  → gather context in parallel (conditions, forecast, shift, readiness, lightning)
  → evaluate_policy                        ← compulsory node
  → lightning STOP_WORK? → deterministic stop-work plan, LLM skipped entirely
  → LLM draft node                         ← the only model invocation
  → validate (allowlist · mandatory coverage · schema)
  → persist Recommendation (PENDING_APPROVAL)
  → notify supervisor
```

The draft node is deliberately narrow. **In:** policy output (mandatory and advisory actions
with codes and rule references), shift context, conditions, forecast. **Out:** those actions,
prioritised, worker-targeted and explained.

Two post-conditions enforced in code, not prompt:

- every `actionCode` is in the allowlist;
- every `MANDATORY` policy action appears in the plan.

Failing either discards the draft and falls back to a deterministic template assembled
directly from policy output — the §8.5 no-LLM fallback, and AT-11.

Service placement follows §10.1 — clients never reach Python directly:

```
web / mobile → Spring Boot /api/v1/… → ml-service /agent/draft → Bedrock
                     ↓
        persists Recommendation, enforces the allowlist, writes audit events
```

The agent lives in a new `agent/` package inside the existing `ml-service/`, which already
provides FastAPI, Pydantic, Bedrock plumbing and a Dockerfile. A second service would need
its own ECR repository, Terraform root and CI workflow, none of which exist even for the
first one.

### Bedrock integration

`ml-service/bedrock_client.py` is spike-grade in three ways that matter for this ticket:

1. `_get_schema()` builds a JSON schema that is **never sent** — structured output is a
   prompt instruction plus `json.loads`.
2. Token count is `len(prompt.split()) * 1.3`, so any cost comparison built on it is
   unreliable.
3. It uses the legacy `bedrock-runtime` `invoke_model` path.

Replace with the Anthropic SDK's Bedrock client (`pip install "anthropic[bedrock]"`):

```python
from anthropic import AnthropicBedrockMantle
client = AnthropicBedrockMantle(aws_region="ap-southeast-1")
```

This provides API-enforced structured outputs, strict tool schemas (§22: *"tools use strict
schemas"*) and real `usage` token counts. Bedrock model IDs carry an `anthropic.` prefix.

Note that Bedrock does not offer a hosted agent runtime, so the loop is self-hosted — which
§10.3 already assumed.

**Separate defect, fix in passing:** `BedrockProperties` binds
`@ConfigurationProperties(prefix = "crewsafe.bedrock")` while `application.yml` defines the
block under `app.bedrock`. Nothing in that YAML is bound today; the class's hardcoded
defaults win and environment overrides are silently ignored.

### Model selection

§8.6 already mandates a fixed evaluation set of at least 30 scenarios with six named
metrics. Building that set first and using it as the model bench makes one artifact serve
three purposes: model choice, US-08 acceptance, and the §22 checklist.

Coverage per §8.6: every WBGT boundary, current-vs-forecast band differences, mixed
intensity, acclimatising workers, missing readiness checks, stale data, conflicting context.
Boundary values seeded from the existing AT-01–AT-04 cases (31.9 / 32.0 / 33.0 heavy,
acclimatisation day 2) so the harness agrees with the backend suite by construction.

Candidate models are whatever `aws bedrock list-foundation-models --region ap-southeast-1
--by-provider anthropic` reports as enabled; access is granted per-model in the console.

**Decision rule, fixed before the first run:**

1. **Gate** — unsupported-action rate must be zero; any model that invents a code is
   disqualified regardless of other scores (§8.6).
2. **Rank** — mandatory-action recall, then policy-citation accuracy, then correct
   affected-worker selection.
3. **Tie-break** — p95 latency, then measured cost per run.

The resulting model × metric table is committed here and is the stated justification for the
model choice.

### Triggers

| Trigger | Entry point |
|---|---|
| Supervisor-initiated | `POST /api/v1/sites/{siteId}/shifts/{shiftId}/recommendations/generate` (§12.1), role-gated + `@siteAccess` |
| Automatic | Scheduled evaluator after weather ingestion, on band transition only |

Auto-trigger guards, none optional:

- **Dedup** — one open `PENDING_APPROVAL` recommendation per shift; a new band change
  supersedes rather than stacks.
- **Shift state** — `ACTIVE` only; `CANCELLED` (SCRUM-255) and `CLOSED` are skipped.
- **Stale data** — `STALE` freshness produces the §7.1 conservative advisory, not a normal
  plan.

Both paths run the same graph; the trigger supplies `trigger.type` and the audit actor
(`SYSTEM` vs the supervisor).

### Libraries

| Library | Decision |
|---|---|
| Pydantic v2 | Yes — already present; the validation boundary for §8.5 |
| LangGraph | Yes — the deterministic graph above; clean per-node tracing |
| LangChain core | **Recommend omitting** — §10.3 lists it, so this needs a team decision. It interposes on `output_config.format` and `strict: true`, the exact features providing the guarantees. LangGraph nodes are plain functions and do not require it. |
| Anthropic SDK | Yes — replaces raw `boto3.invoke_model` |
| boto3 | Retained, narrowed to the control plane (`list-foundation-models`) |
| LangSmith | Yes — US-36, §8.5, AT-22; correlate on the `X-Request-Id` UUID standardised in SCRUM-180 |
| pytest | Yes — hosts the §8.6 evaluation set |

## Feature scope

**In scope.** Heat-stress rest and hydration (the core; every input is live). Shift rotation
and task reassignment — cheap, since `ROTATE_TO_LIGHT_DUTY` is already in the dispatch
catalogue and §8.4 already routes reassignment through supervisor approval, making
"agent proposes, supervisor approves" correct by construction; requires `appliesTo[]`.

**In scope, built last.** Ramadan mode — opt-in fasting-aware scheduling. Nothing in the
repository or project plan addresses fasting workers, which makes it the most original item
here. It is safely deferrable provided two hooks are reserved when the output contract is
built:

| Reserve now | Cost | Avoids later |
|---|---|---|
| `FASTING_ADJUSTMENT` in the `category` enum, emitting nothing | One enum value | A frontend change plus a seven-locale i18n pass; SCRUM-205 rules out machine translation for safety strings, so that means a native-speaker review cycle |
| `appliesTo[]` per-worker targeting | Already required for shift rotation | Ramadan is per-worker opt-in and reuses it exactly |

With both reserved, the remaining work is one additive `ALTER TABLE app_user ADD COLUMN`
(no backfill), two action codes and two policy rules.

**Privacy — requires team agreement before implementation.** §19.1 prohibits collecting
sensitive personal data and §19.2 prohibits inferring worker vulnerability. The compliant
shape is a self-declared operational preference: worker-set only, never supervisor-set, never
inferred, with no religious attribute stored — modelled on the readiness check, which §5.2 is
careful to frame as *"operational context, not a medical assessment."*

**Out of scope.** PSI / air-quality alerts. The only one of the candidate features requiring
a new external feed: a data.gov.sg client, table, migration, ingestion scheduler, freshness
classification and new policy rules. The real cost is a **second hazard hierarchy** — §7.1
currently defines exactly one override chain (lightning supersedes heat), and adding haze
means ranking three hazards, which is a product decision rather than an implementation
detail. Recorded here as considered and deferred.

## Build order

US-07 and US-08 are 8 points each against a 66-point sprint board. The order below places
the cut line explicitly: **everything through phase 5 is a complete, demonstrable US-08.**

| Phase | Work | Cuttable |
|---|---|---|
| 0 | Clear the PR queue per *Merge order* (#126 done; #124 needs the `V10` renumber) | No — blocks all |
| 1 | Reconcile the three `PolicyDecision` naming deltas + nullable `forecastBand` | No |
| 2 | Bedrock client replacement, model enumeration, `BedrockProperties` prefix fix | No |
| 3 | §8.6 evaluation set + model bench + committed decision table | No |
| 4 | Extended `MitigationSuggestion`, allowlist, `appliesTo[]`, `recommendation.yaml`, frontend handoff | No |
| 5 | Agent graph + supervisor-triggered endpoint + no-LLM fallback | No — **US-08 complete** |
| 6 | Auto-trigger on band change | Yes |
| 7 | Ramadan mode | Yes |
| 8 | LangSmith tracing (US-36, *Should*) | Yes |

Phase 4 should be front-loaded once phase 0 clears: the frontend is blocked on it and it is
the cheapest item on the list.

## Verification

**Policy engine** — `./mvnw test`: AT-01–AT-04 boundaries (31.9 / 32.0 / 33.0 heavy,
acclimatisation day 2) plus lightning-overrides-heat ordering, against real PostgreSQL via
Testcontainers.

**Bedrock** — `aws bedrock list-foundation-models --region ap-southeast-1`, then one live
call asserting `response.usage.input_tokens > 0`, proving real counts rather than the
word-count estimate.

**Model bench** — `pytest ml-service/tests/test_agent_eval.py` emits the model × metric
table. Gate assertion: unsupported-action rate is zero.

**Contract** — validate `docs/api/recommendation.yaml`, serve it under a Prism mock and call
it from `web/`, the same verification used for the readiness contract in SCRUM-162.

**End to end (Sprint 2 exit criterion)** — `WEATHER_DATA_MODE=fixture ./run.sh` replays the
three-frame heat-escalation scenario in `nea-demo-replay.json`. Expected chain: band change →
recommendation drafted `PENDING_APPROVAL` → supervisor approves in web → fan-out to
`action_dispatch` → worker acknowledges on mobile with a correct rest countdown (proving the
dispatch code mapping) → `audit_event` rows for each step sharing one correlation id.

**Guardrails** — the demo-relevant cases:

- unknown action code from the model → draft rejected, deterministic template used (AT-11);
- mandatory action omitted → draft rejected;
- Bedrock timeout → deterministic fallback, request still succeeds;
- dispatch attempted without an `APPROVED` approval → rejected and audited.

## Open decisions

1. ~~**Migration renumbering**~~ — resolved: #126 took `V9`. **Follow-up:** #124 must move
   `V8` → `V10` before merging.
2. ~~**Policy output shape**~~ — resolved in `3b6c36c`. **Follow-up:** three field-naming
   deltas against mobile's `PolicyEvaluation`, plus nullable `forecastBand`.
3. **One approval flow** — the `recommendation`/`approval` tables, not `agent_draft_plans`;
   the deciding factor is that the latter cannot reach a worker.
4. **LangChain** — §10.3 lists it; this plan recommends omitting it. Needs an explicit
   decision rather than a silent departure.
5. **Ramadan privacy framing** — agree before building.
6. **Weather range endpoint** — only `/weather/latest` is exposed; needed for trend
   reasoning.

## Retro note

Three PRs implemented overlapping halves of one pipeline against three different contracts,
and none of it surfaced until integration. The team already has a contract-first convention —
`docs/api/*.yaml` was written before the code for SCRUM-162 and SCRUM-184. Applying it to
`recommendation.yaml` ahead of implementation would have caught every conflict listed above
on day one.
