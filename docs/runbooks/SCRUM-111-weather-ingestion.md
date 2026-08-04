# SCRUM-111 weather ingestion

This runbook explains where CrewSafe obtains weather data, why there are five external
requests, and how to exercise live or deterministic fixture ingestion locally.

## What it is

Weather ingestion is an internal scheduled backend job. There is deliberately no manual
`/weather/ingest` endpoint: when enabled, the scheduler asks data.gov.sg for a complete
weather snapshot and saves the nearest available reading for every CrewSafe site.

The authenticated frontend reads that stored data from:

```text
GET /api/v1/sites/{siteId}/weather/latest
```

The caller must be allowed to access `{siteId}`. The endpoint returns `404` until ingestion
has stored the first snapshot; its complete contract is in `docs/api/weather.yaml`.

The implementation is split across three SCRUM-111 stories:

- SCRUM-165 adapts the live data.gov.sg responses into CrewSafe's stable weather model.
- SCRUM-166 schedules collection, chooses nearest stations, labels freshness, and saves
  each site snapshot without duplicates.
- SCRUM-167 supplies deterministic fixture replay for offline demonstrations and tests.

## Live data.gov.sg endpoints

All requests use this base URL:

```text
https://api-open.data.gov.sg/v2/real-time/api
```

| CrewSafe metric | Method and path | Complete URL |
| --- | --- | --- |
| WBGT | `GET /weather?api=wbgt` | <https://api-open.data.gov.sg/v2/real-time/api/weather?api=wbgt> |
| Air temperature | `GET /air-temperature` | <https://api-open.data.gov.sg/v2/real-time/api/air-temperature> |
| Relative humidity | `GET /relative-humidity` | <https://api-open.data.gov.sg/v2/real-time/api/relative-humidity> |
| Wind speed | `GET /wind-speed` | <https://api-open.data.gov.sg/v2/real-time/api/wind-speed> |
| Rainfall | `GET /rainfall` | <https://api-open.data.gov.sg/v2/real-time/api/rainfall> |

WBGT deliberately uses `/weather?api=wbgt`; there is no `/wbgt` path. Its response embeds
station details inside each reading. The other four endpoints return station metadata and
reading batches separately. `DataGovSgNeaWeatherClient` normalises both shapes into
`NeaObservation`, so no data.gov.sg response class leaks into ingestion code.

The feeds use independent stations and timestamps. CrewSafe therefore chooses the nearest
available station separately for each metric. The combined database row uses WBGT's
timestamp and station as its anchor because WBGT is the primary heat-safety signal.

data.gov.sg permits keyless development requests. Set `NEA_API_KEY` for higher production
rate limits; the client sends it as the `x-api-key` header when present. See the
[official API overview](https://guide.data.gov.sg/developer-guide/api-overview).

## Run live ingestion locally

From the repository root:

```bash
WEATHER_DATA_MODE=live WEATHER_INGESTION_ENABLED=true ./run-docker.sh
```

Use `./run.sh` instead when running Podman. To include an API key for local testing:

```bash
NEA_API_KEY='<your-key>' WEATHER_INGESTION_ENABLED=true ./run-docker.sh
```

Do not commit an API key. Staging and production must inject it as a secret.

Collection is disabled by default. When enabled, it starts after five seconds and repeats
every fifteen minutes unless the deployment overrides the `WEATHER_INGESTION_*` settings in
`backend/src/main/resources/application.yml`.

## Run without external endpoints

Fixture mode replays the bundled synthetic scenario and never calls data.gov.sg:

```bash
WEATHER_DATA_MODE=fixture WEATHER_INGESTION_ENABLED=true ./run-docker.sh
```

The replay normally advances to its last frame and stays there. Set
`WEATHER_FIXTURE_LOOP=true` to return to the first frame after the last one.

Every fixture observation is marked `SIMULATED` and stored with source `CACHED`. The service
rejects any snapshot that mixes live and simulated measurements.

## Troubleshooting

### No weather requests appear

Check these conditions in order:

1. `WEATHER_INGESTION_ENABLED` must be `true`; its safe default is `false`.
2. `WEATHER_DATA_MODE` must be `live`; fixture mode intentionally makes no network calls.
3. At least one site must exist. Ingestion returns immediately when there are no sites.
4. Follow backend logs with `docker compose -f local/compose.yaml logs -f backend`.

### One endpoint looks different

That is expected for WBGT. Use `/weather?api=wbgt`, not `/wbgt`, and do not try to decode it
with the response records used by the other four endpoints.

### An endpoint fails or omits a station

The live adapter rejects incomplete response envelopes, station metadata, reading batches,
and unknown station references. Ingestion requires all five metrics and saves nothing when
the external snapshot is incomplete. This prevents partial safety data from appearing
complete.

### Duplicate rows are not appearing

That is expected. PostgreSQL enforces uniqueness for a site, observation time, and source.
Repeated fixture frames and concurrent ingestion attempts keep the first row and count later
attempts as duplicates.
