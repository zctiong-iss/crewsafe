# Brief: CrewSafe needs a real lightning data source

**Status:** blocking. **Audience:** whoever owns backend ingestion.

The mobile app has a lightning stop-work banner. It has always been fed by a fixture. A
request to add a live/simulated toggle to it was deferred because **there is nothing to switch
to** — no part of the system holds a lightning observation.

This is what would have to exist. Nothing here is started.

---

## What the system has today

Verified against `main` on 2026-08-06:

| | |
| --- | --- |
| NEA metrics ingested | `air-temperature`, `relative-humidity`, `wind-speed`, `rainfall` — `DataGovSgNeaWeatherClient` |
| Derived | WBGT, from those four |
| `weather_observation` columns | wbgt, temperature, humidity, wind_speed, rainfall, observed_at, ingested_at, source, quality_status, station_id |
| Lightning columns | **none** |
| Lightning table | **none** |
| Lightning endpoint | **none** — `GET /api/v1/sites/{siteId}/lightning` is referenced by the mobile client and does not exist |
| `/conditions/stream` (SSE) | carries WBGT, the four metrics, freshness, active shift — **no lightning** |

The only server-side mention of lightning is a comment in `Site.java` about evaluating
lightning proximity, which nothing implements.

## Why weather data cannot stand in for it

The obvious shortcut is to infer lightning from heavy rainfall, or from the app's
`THUNDERY_SHOWERS` classification. **Do not.** That classification is an inference from four
numbers, and `helpers/weather.ts` is explicit that it is allowed *only* because nothing acts on
it — it picks an icon.

A lightning state is the opposite: it is the input to a stop-work instruction. Inferring it
would mean the app telling a crew to take shelter, or not to, based on a guess about rainfall.
A false negative there is someone left outdoors in a storm.

## What is needed

### 1. A source

NEA publishes lightning observations, and data.gov.sg is the same platform the existing
weather ingestion already uses — so the authentication, rate limits and failure handling are
likely to be familiar. **Confirm the exact dataset and its terms before designing around it**;
this brief does not assume a particular endpoint, because the existing client only covers the
four weather metrics and nobody has checked what lightning coverage is actually published.

The questions that decide the whole design:

- **What does a reading contain?** A strike location and timestamp, or an area/cell alert?
- **What is the update cadence?** The weather ingestion runs on a fixed delay; lightning is
  useful only if it is minutes fresh, not tens of minutes.
- **What is the spatial resolution?** Strike coordinates allow a real proximity radius per
  site. A nationwide flag does not, and would put every site into stop-work together.
- **Is there a licence or attribution requirement** beyond what the weather feed already
  carries?

If NEA does not publish something usable, that is a finding worth having early — it makes this
a commercial-data question rather than an engineering one.

### 2. Storage

A `lightning_observation` table, sibling to `weather_observation`, with the same discipline
that one already gets right:

- `observed_at` **and** `ingested_at` kept separate — the freshness classifier depends on it
- `source` and `quality_status`, so a fixture replay is distinguishable from live data at the
  row level rather than by configuration
- site scoping, and whatever proximity measure the source supports

`quality_status` matters more here than for weather. A stale lightning reading is not a
slightly-old number; it is a stop-work that may already be over, or one that has not started.

### 3. Evaluation, server-side

The band or state must be evaluated on the server, exactly as `WbgtBand` is for heat. §12.2
forbids a client submitting or overriding a risk band, and FR-15 makes the backend engine
authoritative for anything deciding what a worker must do. A stop-work is the strongest such
decision in the product.

`WbgtBand.classify` is the pattern: an enum, a pure classifier, boundary tests, and a null
that stays null rather than defaulting to the safe-looking value.

The states the mobile app already renders are `CLEAR`, `ADVISORY`, `STOP_WORK`, plus an expired
treatment. `validUntil` is part of the contract and must come from the server — the app already
refuses to treat a lapsed assessment as an all-clear, and that only works if the server says
when an assessment expires.

### 4. Endpoint

`GET /api/v1/sites/{siteId}/lightning`, site-scoped with
`@PreAuthorize("@siteAccess.canAccess(#siteId)")` like every other site endpoint. Response
shape is already committed to by `mobile/src/api/mock/lightning.ts` — worth reading before
designing it, since matching it means the mobile change is deleting a branch rather than
rewriting a screen.

A 404 for "no data yet" is fine and the client can handle it. What must **never** happen is
returning `CLEAR` when the answer is "unknown": those are the same pixels and opposite
meanings.

### 5. Ingestion toggle

Follow `WEATHER_INGESTION_ENABLED` and `WEATHER_DATA_MODE`: opt-in per environment, with a
fixture replay mode that stamps `SIMULATED` so nothing can mistake a demo for a live feed.

## What the mobile side will then be

Small, and already scoped. `fetchLightningRisk` currently returns `mockLightningRisk(siteId)`
unconditionally. It becomes the same `isMockApi()` branch `fetchSiteWeather` already uses, and
the deferred live/simulated toggle becomes buildable — with "live" meaning the server's answer
and nothing else.

Until then the banner stays honestly marked `SIMULATED`, which is the correct behaviour and not
a bug.

---

## Suggested ticket split

1. **Spike** — confirm what NEA actually publishes: content, cadence, resolution, licence.
   Timeboxed. Its output decides whether 2–4 are worth writing.
2. **Backend** — table, migration, ingestion job, fixture mode, server-side evaluation, tests.
3. **Backend** — the endpoint, site-scoped, with the response shape the mobile mock commits to.
4. **Mobile** — consume it; then the deferred live/simulated toggle.

1 blocks everything. 4 is the deferred Part 2 of the Heat-card ticket
([`SCRUM-260-heat-card-stop-work-legibility-plan.md`](SCRUM-260-heat-card-stop-work-legibility-plan.md)).
