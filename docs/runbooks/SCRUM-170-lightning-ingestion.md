# SCRUM-170 lightning ingest and stop-work state derivation

This runbook explains where CrewSafe obtains lightning-strike data, how the stop-work state
is derived, and how to exercise live or fixture ingestion locally. It complements
`SCRUM-111-weather-ingestion.md`, which this feature reuses the ingest/freshness machinery
from — read that one first if the scheduler/adapter/fixture pattern is unfamiliar.

## What it is

Lightning ingestion is an internal scheduled backend job, structurally identical to weather
ingestion but on its own cadence: NEA refreshes lightning roughly every two minutes, far more
often than WBGT's fifteen, because a stop-work decision cannot wait on the heat-data poll
interval. Each tick stores the nearest strike (if any) to every CrewSafe site.

Unlike WBGT, the derived risk state — `CLEAR` / `ADVISORY` / `STOP_WORK` — is never stored
directly. `LightningRiskDerivationService` recomputes it on every read from a window of
recent `lightning_observation` rows, the same "don't trust storage" discipline
`ConditionsSnapshotService` already applies to WBGT freshness. It is published as the
`lightning` field on the existing SCRUM-168 conditions SSE stream
(`GET /api/v1/sites/{siteId}/conditions/stream`), so web and any future client render from
one source of truth.

## The live endpoint

```text
GET https://api-open.data.gov.sg/v2/real-time/api/weather?api=lightning
```

The same unified `/weather` endpoint WBGT uses (`?api=wbgt`), distinguished by the `api`
query value. **This is not documented in data.gov.sg's public developer guide** as of this
writing — `uv-index`, `forecast`, and `lightning` all 403 with a generic
`MissingAuthenticationTokenException` when probed directly, indistinguishable from a
genuinely unmapped route. The shape was recovered from the dataset's own downloadable
OpenAPI spec and confirmed against a live call while scoping this ticket:

```bash
curl "https://api-open.data.gov.sg/v2/public/api/datasets/d_08238953fe0f6dd13f10714ebfbcb9f9/initiate-download"
# -> presigned S3 URL to LightningObservation.json, an OpenAPI 3.0.3 spec document
```

Response shape (`DataGovSgNeaLightningClient`'s private records mirror this exactly):

```json
{
  "code": 0,
  "errorMsg": "",
  "data": {
    "records": [{
      "datetime": "2026-08-06T07:44:00+08:00",
      "item": {
        "readings": [{
          "location": {"latitude": "1.4349", "longitude": "103.4280"},
          "type": "C",
          "text": "Cloud to Cloud",
          "datetime": "2026-08-06T07:43:26.243+08:00"
        }],
        "type": "observation",
        "isStationData": false
      },
      "updatedTimestamp": "2026-08-06T07:46:02+08:00"
    }]
  }
}
```

`readings` is frequently empty — most two-minute windows see no strikes at all, and that is
a valid result, not an error. `type` is `"C"` (cloud-to-cloud) or `"G"` (cloud-to-ground). No
station identity exists; each reading is a raw geolocated strike, so `NearestStrikeSelector`
computes distance directly rather than joining to station metadata like
`NearestStationSelector` does for WBGT.

## Stop-work derivation policy

**Neither the exact distance thresholds nor the expiry model are specified** by SCRUM-170,
its Jira parent (SCRUM-112), or the project plan's §7.1 — which says only "hold until a
supervisor-confirmed all-clear (typically 30 minutes after the last nearby strike)". Product
direction for this pass, confirmed while scoping the ticket:

- **Auto-expire on a fixed validity window**, not a manual supervisor confirmation action.
  A state (`ADVISORY` or `STOP_WORK`) holds until the qualifying strike's own timestamp plus
  the configured window passes, then reverts — no endpoint or UI action clears it early.
- **Distance bands**: the common "30-30 rule" convention — 10km stop-work / 20km advisory.
- **Window**: 30 minutes, matching the plan's "typically" figure, applied uniformly to
  `CLEAR` (a clear reading still carries a validity window — "assessed clear as of this
  read, re-check after this" — so the client can tell clear from stale-and-unknown),
  `ADVISORY`, and `STOP_WORK`.

All three are `app.lightning.risk.*` configuration (`LightningRiskProperties`), not
constants, so they can be retuned without a redeploy once a real policy is confirmed.

`STOP_WORK` always outranks `ADVISORY` regardless of which qualifying strike is more recent
— see `LightningRiskDerivationService.deriveState`.

## Run live ingestion locally

```bash
WEATHER_DATA_MODE=live LIGHTNING_INGESTION_ENABLED=true ./run-docker.sh
```

Lightning shares `WEATHER_DATA_MODE` with weather ingestion — one toggle for whether this
instance calls real government APIs at all. `LIGHTNING_INGESTION_ENABLED` is its own flag
(default `false`), independent of `WEATHER_INGESTION_ENABLED`, so either feed can be enabled
without the other.

## Run without external endpoints

```bash
WEATHER_DATA_MODE=fixture LIGHTNING_INGESTION_ENABLED=true ./run-docker.sh
```

Replays `backend/src/main/resources/lightning/fixtures/nea-demo-replay.json`: a storm
approaches Bishan Park Landscaping from ~15km (advisory) to ~4km (stop-work) over three
ticks, then stops producing strikes. The final frame is 33 minutes after the last strike, so
it demonstrates the 30-minute hold expiring back to `CLEAR`. Set `LIGHTNING_FIXTURE_LOOP=true`
to loop back to the first frame instead of holding the last one.

Every fixture reading is marked `SIMULATED` and stored with source `CACHED`, same as weather.

## Troubleshooting

### The conditions stream shows `"lightning": null`

That means lightning has never been ingested for the site — distinct from `CLEAR`, which
means it *has* been assessed and found clear. Check `LIGHTNING_INGESTION_ENABLED` and that
at least one ingestion tick has run.

### State doesn't clear when I expect it to

Check `LIGHTNING_VALIDITY_WINDOW` (default 30m) against the qualifying strike's own
timestamp, not the ingestion tick time — those can differ. `LightningRiskDerivationService`
uses the strike's `nearest_strike_at`, not `observed_at` (which only drives freshness).

### `NEA lightning ingestion failed` in the logs

Same pattern as weather: the scheduler swallows the exception and retries next tick. Given
the live endpoint is unconfirmed by data.gov.sg's own documentation, verify it hasn't moved
by re-running the `initiate-download` OpenAPI-spec check above before assuming a CrewSafe bug.
