# SCRUM-289 — running the agent end to end (demo runbook)

How to see US-08 actually work: a supervisor taps **Draft a plan** on a shift, a real model
call happens, and an explainable plan comes back with the readings that produced it.

## What has to be running

Three processes, and one of them is not in the Compose file.

| | What | Why it is where it is |
|---|---|---|
| 1 | Postgres + backend (Compose) | `./run-docker.sh` or `./run-podman.sh` from the repo root |
| 2 | **ml-service, on the host** | It needs AWS credentials for Bedrock, which do not belong in a checked-in local stack |
| 3 | Mobile (Expo) | The supervisor's screen |

The backend reaches ml-service via `host.docker.internal:8000`, wired in `local/compose.yaml`.
Do not change it to `localhost` — inside the container that is the container itself.

## Step 1 — ml-service, with live Bedrock

```bash
conda activate ml_sandbox
cd ml-service
AWS_PROFILE=crewsafe AWS_REGION=ap-southeast-1 python -m uvicorn app:app --port 8000
```

Wait for this line. If it does not appear, the demo will run but the model will never be
called — see *Reading the result* below.

```
INFO:app:Bedrock startup: ✓ Bedrock model access confirmed in region=ap-southeast-1
```

## Step 2 — the rest of the stack

```bash
./run-docker.sh            # or ./run-podman.sh
```

Backend health: <http://localhost:8080/actuator/health>.

## Step 3 — give the site a heat policy (once per fresh database)

**This is the step that catches people out.** `V9`'s seeding INSERT is commented out and `V12`
carried forward from that empty table, so a fresh database has *no* policy version for any
site, and the endpoint correctly refuses with a 409 (it will not decide what a worker must do
using thresholds nobody signed off on).

Do it through the real Safety Manager API — the first version a site gets auto-activates:

```bash
SITE_ID=...            # from GET /api/v1/sites
TOKEN=...              # a SAFETY_MANAGER token (manager1)

curl -sX POST "http://localhost:8080/api/v1/sites/$SITE_ID/policy-versions" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "versionLabel": "MOM-WBGT-2026.1",
    "source": "MOM Work-Rest Guidelines 2026",
    "effectiveDate": "2026-01-01",
    "wbgtThresholdUnacclimatisedLight": 25.0,
    "wbgtThresholdUnacclimatisedModerate": 23.0,
    "wbgtThresholdUnacclimatisedHeavy": 21.0,
    "wbgtThresholdPartialLight": 26.0,
    "wbgtThresholdPartialModerate": 24.0,
    "wbgtThresholdPartialHeavy": 22.0,
    "wbgtThresholdFullLight": 28.0,
    "wbgtThresholdFullModerate": 26.0,
    "wbgtThresholdFullHeavy": 24.0,
    "wbgtEmergencyStop": 33.0
  }'
```

Field names verified against `PolicyVersionController.PolicyVersionCreateRequest`. All twelve
thresholds are required and each must be ≥ 15; `wbgtEmergencyStop` must be between 20 and 40.
`notes` is the only optional field.

## Step 4 — make sure there is something to assess

The site needs a recent WBGT reading, and the shift needs workers on it.

- **Weather**: ingestion runs on a schedule. `WEATHER_DATA_MODE=fixture` replays bundled
  demo data and is the deterministic choice for a meeting; `live` calls data.gov.sg. Either
  way, confirm a row exists before you present:
  `select wbgt, observed_at, quality_status from weather_observation order by observed_at desc limit 1;`
- **Shift**: PLANNED or ACTIVE, with at least one assignment. A CLOSED or CANCELLED shift is a
  400 by design.

Nothing to assess is a **409**, not a crash — the agent refuses rather than inventing a reading.

## Step 5 — the demo itself

In the mobile app, as a supervisor: **Shifts → a shift → Draft a plan**.

It takes **10–20 seconds**. That is a real model call, not a hang — the button shows a loading
state throughout. Say so before you tap it, or the silence looks like a failure.

Then: **Plans tab → pull down to refresh → open the plan.** Mobile has no push notification for
a new draft, so the pull-to-refresh is required, not optional.

## Reading the result — the one thing to check

**`modelVersion` on the recommendation tells you which path actually ran.**

| Value | What happened |
|---|---|
| `global.anthropic.claude-haiku-4-5-...` | The model wrote this plan |
| `deterministic-fallback` | The model was unreachable, or its draft failed the validation gate |
| `deterministic-lightning` | Lightning stop-work — the model was deliberately never called |

This matters more than it sounds. **A fallback plan is a complete, correct, approvable plan** —
every mandatory action, every rule reference, correct worker targeting. It looks entirely normal
on screen. So "a plan appeared" does *not* prove the agent called Bedrock. If ml-service is not
running, or `BEDROCK_API_URL` is wrong, you will get a perfectly good plan that the model never
touched, and nothing on the screen will say so. Check the field.

## If you have five minutes and no stack

The ml-service half alone demonstrates the interesting part, and needs only step 1:

```bash
curl -s -X POST http://127.0.0.1:8000/agent/draft \
  -H 'Content-Type: application/json' -d @docs/examples/agent-draft-request.json | python3 -m json.tool
```

Two things worth showing from that response: `usedFallback: false` with a real `modelId`, and
then the same request with ml-service started against a bad `BEDROCK_MODEL_ID`, which returns
`usedFallback: true` and a complete plan anyway — the safety story in two commands.

## Known gaps to state rather than hide

- **The 30-minute forecast is not a prediction yet.** `/forecast` is still the persistence
  baseline, whose output equals the current reading. SCRUM-114's trained model exists (PR #217)
  but is not wired to the API — that is SCRUM-281. Every response carries
  `forecastModelVersion: "baseline-1.0.0"` so this is visible rather than implied.
- **Web has no recommendation UI at all.** The demo is mobile only.
- **No auth between backend and ml-service.** Fine on localhost, must be closed before anything
  is deployed.
