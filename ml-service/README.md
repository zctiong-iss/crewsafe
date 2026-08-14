# CrewSafe ML and Bedrock FastAPI Service

FastAPI service for the Bedrock spike and SCRUM-114's versioned 30/60-minute
WBGT forecasting pipeline.

## WBGT training workflow (SCRUM-114)

Generated datasets and artifacts are intentionally ignored by Git. The commands
below are reproducible; never commit API keys, raw downloads, or unverified
model files.

Offline training and backtesting paths are restricted to the current ML
workspace. Local commands run from `ml-service`, so their `data/` and
`artifacts/` paths stay inside that folder. SageMaker automatically provides
`SM_MODEL_DIR`; jobs using its standard `/opt/ml` layout stay within that fixed
AWS training boundary.

### 1. Download historical observations

```bash
python -m crewsafe_ml.download_dataset \
  --start-date 2026-02-01 \
  --end-date 2026-07-31 \
  --output-directory data/historical
```

This downloads paginated WBGT, temperature, humidity, wind speed/direction, and
rainfall data from allowlisted data.gov.sg endpoints. It stores raw pages
separately, validates values and station references, and writes a normalized CSV
plus SHA-256 manifest. Running the same command again safely reuses completed raw
pages and continues after the last saved pagination token. A different date range
or metric list must use a new output folder, preventing mixed dataset versions.

The completed folder contains:

- `weather_readings.csv`: all validated observations in a standard long format.
- `weather_features_15min.csv`: the leakage-safe 15-minute ML training table.
- `station_inventory.csv`: station names, locations, counts, and date coverage.
- `station_metadata_corrections.csv`: official name or small coordinate corrections
  that were accepted and recorded; identity changes or movements over 2 km stop the
  build.
- `missing_periods.csv`: internal gaps based on each feed's expected interval.
- `manifest.json`: source licence, quality totals, filenames, and SHA-256 checksums.
- `download_state.json` and `raw/`: the checkpoint and original source evidence.

Official `NA` readings remain in the raw evidence, are excluded from numeric
training rows, and are counted by metric in the manifest. The downloader allows
at most 100 pages per metric and day by default. Use `--max-pages-per-day` only
when an official response proves that a higher safety limit is required. This is
an offline developer/training workflow; the live app never downloads this data
when starting or making a prediction.

Some historical pages contain a reading whose station details were omitted from
that page. The downloader may reuse matching official station metadata from an
earlier validated page for the same metric and day. It never invents station
details, rejects unseen or conflicting station identities, preserves the raw
response, and counts recovered readings in the quality manifest.

For each WBGT timestamp, feature preparation uses the nearest supporting-weather
station whose latest observation is no more than eight minutes old. It checks the
next-nearest station when a closer station is silent and never uses a future
observation.

### 2. Train and compare models

```bash
python -m crewsafe_ml.train \
  --dataset data/historical/weather_readings.csv \
  --dataset-manifest data/historical/manifest.json \
  --output-directory artifacts
```

The pipeline verifies the normalized dataset checksum, recreates the same
leakage-safe 15-minute features, and makes chronological windows. It compares
persistence, Ridge, `HistGradientBoostingRegressor`, and a conservative variant
that never predicts below the current WBGT, separately for 30 and 60 minutes. It
records MAE, RMSE, bias, band F1/recall, confusion matrices, data
checksum, exact hyperparameters, random seed, runtime, source commit, and artifact
checksums. Prediction intervals are calibrated on validation residuals; the final
test window is used only for the untouched result report and acceptance gate. A
trained model is selected only when it beats persistence MAE without reducing
high-risk recall. The saved
15-minute CSV is also convenient for inspection or a later SageMaker experiment.

Use rolling historical windows to check whether a candidate's result is stable
before evaluating it on a new untouched period:

```bash
python -m crewsafe_ml.backtest \
  --features data/historical/weather_features_15min.csv \
  --feature-manifest data/historical/manifest.json \
  --evaluation-end 2026-07-01T00:00:00Z \
  --output artifacts/rolling-backtest.json
```

The rolling report is development evidence, not permission to activate a model.
The evaluation end must precede the untouched approval period.

After freezing a candidate, download a later period into a separate folder and
evaluate that exact checksum-pinned bundle without retraining it:

```bash
python -m crewsafe_ml.evaluate_approval \
  --model-manifest artifacts/wbgt-six-month-frozen-candidate-v2/manifest.json \
  --model-manifest-sha256 ad0a3ba2f1a7e587ceaa7333c8bf65afe6535c0b31f0d15cb9028ca41e3b9359 \
  --features data/approval-2026-08-15-to-2026-09-04/weather_features_15min.csv \
  --feature-manifest data/approval-2026-08-15-to-2026-09-04/manifest.json \
  --output artifacts/approval-2026-08-15-to-2026-09-04-v2.json
```

The default evidence window is at least 21 complete days. The report checks that
the period begins after both the training data and the frozen candidate's creation,
verifies model and data checksums, compares both horizons with persistence, and
requires no loss of recall at 32°C
or 33°C. It is evidence for a human review, not an automatic unlock. A report
also stays blocked when the model was produced from an unreviewable `dirty`
source commit or the new period contains no high-risk examples.

The exact download command, dates, and human-review checks for this frozen
candidate are in
[`docs/runbooks/SCRUM-114-model-approval.md`](../docs/runbooks/SCRUM-114-model-approval.md).

The current six-month development evaluation, intended use, uncertainty,
limitations, per-band errors, and retraining triggers are recorded in
[MODEL_CARD.md](MODEL_CARD.md).

### 3. Trained forecast integration (SCRUM-281)

The `/forecast` response contract is unchanged. Existing clients may keep sending
`metric`, `horizon_minutes`, and `current_value`; without recent context the service
returns the labelled `baseline-1.0.0` persistence result.

To activate a trained WBGT model, deploy a reviewed bundle outside the container
image and configure both values below. The manifest and each referenced artifact
are checksum-verified before use. Never activate the development-only bundle while
its model card or manifest contains an approval blocker. Training always writes
`"approved_for_inference": false`; a reviewed promotion must change it to `true`
and publish the checksum of that exact promoted manifest.

```bash
WBGT_MODEL_MANIFEST=/run/crewsafe-model/manifest.json
WBGT_MODEL_MANIFEST_SHA256=<64-character-manifest-sha256>
```

A trained request adds optional `context` containing 2–16 ordered observations at
15-minute boundaries, the WBGT station identifier, and site coordinates. The
newest observation must be at most 45 minutes old and its WBGT must match
`current_value`. Trained inference is WBGT-only; the existing temperature and
humidity persistence forecasts remain unchanged.

```json
{
  "metric": "wbgt",
  "horizon_minutes": 30,
  "current_value": 33.5,
  "context": {
    "station_id": "S123",
    "latitude": 1.3521,
    "longitude": 103.8198,
    "observations": [
      {
        "observed_at": "2026-08-14T11:45:00Z",
        "wbgt": 33.3,
        "air_temperature": 31.0,
        "relative_humidity": 70.0,
        "wind_speed": 3.0,
        "wind_direction": 180.0,
        "rainfall": 0.0
      },
      {
        "observed_at": "2026-08-14T12:00:00Z",
        "wbgt": 33.5,
        "air_temperature": 31.1,
        "relative_humidity": 69.0,
        "wind_speed": 3.2,
        "wind_direction": 180.0,
        "rainfall": 0.0
      }
    ]
  }
}
```

Invalid or stale context returns `422` with `FORECAST_INPUT_INVALID`. Missing,
untrusted, or unreadable model files return `503` with
`FORECAST_MODEL_UNAVAILABLE`; inference failure returns `503` with
`FORECAST_INFERENCE_FAILED`. These stable error codes preserve SCRUM-141's backend
fallback boundary: the backend, not this service or the frontend, owns the labelled
persistence fallback when a trained request fails. No frontend code is included.

## Security checks

ML CI installs only the checksum-locked Python dependencies, runs all unit and
contract tests, verifies the container user is not root, and fails on high or
critical Python-package vulnerabilities and fixable container vulnerabilities.
Unfixed base-image findings remain visible for review when the pinned image
digest is refreshed.

## Overview

This service:
1. **Verifies Bedrock model access** in a configured AWS region
2. **Returns Pydantic-validated structured objects** proving schema enforcement
3. **Documents latency, cost, and failure modes** for integration planning

The Spring Boot backend calls this service via HTTP, demonstrating timeout and error handling.

## Quick Start

### Prerequisites
- Python 3.11+
- AWS credentials (via `~/.aws/credentials`, env vars, or IAM role)
- Bedrock access enabled in your AWS account

### Install Dependencies
```bash
pip install -r requirements.txt
```

### Run the Service
```bash
# With default region (ap-southeast-1)
python app.py

# With custom region
AWS_REGION=us-east-1 python app.py
```

Service starts on `http://localhost:8000`.

## Endpoints

### 1. Health Check
```bash
curl http://localhost:8000/health
```
Response: `{"status": "ok"}`

### 2. Forecast (SCRUM-188 contract, SCRUM-281 trained integration)
**Versioned trained WBGT or persistence prediction behind one response contract.**

Implements the persistence baseline (naive: next value equals current) that SCRUM-114's trained model must beat. Every prediction is versioned for traceability.

```bash
curl -X POST http://localhost:8000/forecast \
  -H "Content-Type: application/json" \
  -d '{
    "metric": "wbgt",
    "horizon_minutes": 30,
    "current_value": 35.5
  }'
```

**Success Response** (200 OK):
```json
{
  "metric": "wbgt",
  "predicted_value": 35.5,
  "horizon_minutes": 30,
  "model_version": "baseline-1.0.0",
  "confidence_interval_lower": 34.6125,
  "confidence_interval_upper": 36.3875,
  "timestamp": "2026-02-08T12:00:00Z"
}
```

**Request Parameters:**
- `metric` (required): `wbgt`, `temperature`, or `humidity`
- `horizon_minutes` (optional, default 30): 30 or 60 minutes
- `current_value` (required): Current observed value
- `context` (optional): recent readings; required to use the trained WBGT model

**Response Contract (Acceptance Criteria):**
- `predicted_value`: Forecast at horizon (persistence baseline returns current value)
- `model_version`: traced baseline or trained model version for US-06
- `confidence_interval_lower` and `confidence_interval_upper`: 95% confidence bounds
- `timestamp`: Prediction creation time (ISO 8601)

**Acceptance:** Backend consumes end-to-end via typed client. Replacing stub with trained model requires no consumer change.

### 3. Verify Bedrock Access
**Critical for spike acceptance criteria: confirms model access and region.**

```bash
curl http://localhost:8000/bedrock/access
```

**Success Response** (200 OK):
```json
{
  "status": "ok",
  "message": "✓ Bedrock model access confirmed in region=ap-southeast-1 (latency=0.85s)",
  "region": "ap-southeast-1"
}
```

**Failure Response** (503 Service Unavailable):
```json
{
  "status": "error",
  "message": "✗ Model not available in ap-southeast-1. Try us-east-1 as fallback.",
  "region": "ap-southeast-1",
  "recommendation": "Try fallback region us-east-1"
}
```

### 4. Generate Mitigations (Schema-Validated)
**Demonstrates Pydantic struct validation: returns only schema-valid JSON.**

```bash
curl -X POST http://localhost:8000/bedrock/suggest \
  -H "Content-Type: application/json" \
  -d '{
    "context": "Current WBGT: 35°C, 60% humidity, 12 workers. Last water break 30 min ago."
  }'
```

**Success Response** (200 OK):
```json
{
  "mitigations": [
    {
      "priority": "HIGH",
      "action": "Reduce work hours to 20 min active / 10 min rest",
      "rationale": "WBGT at 35°C exceeds safe continuous work limits",
      "estimatedImpact": "10-15% reduction in heat stress risk"
    },
    {
      "priority": "MEDIUM",
      "action": "Increase water breaks to every 15 minutes",
      "rationale": "Hydration critical at high WBGT",
      "estimatedImpact": "5% reduction in dehydration risk"
    }
  ]
}
```

**Timeout Response** (503 Service Unavailable after 5s):
```json
{
  "detail": "Bedrock API timeout. Fallback: try us-east-1"
}
```

**Access Denied** (503 Service Unavailable):
```json
{
  "detail": "Access denied to Bedrock in ap-southeast-1. Check IAM permissions."
}
```

## Key Findings (Spike Results)

### ✓ Bedrock Access Verification
- Runs `verify_access()` at startup
- Confirms model is accessible in configured region
- Raises `BedrockAccessError` if not available (documented in error response)

### ✓ Structured Output (Schema Validation)
- Pydantic models enforce:
  - `priority`: enum `[HIGH|MEDIUM|LOW]`
  - `action`, `rationale`, `estimatedImpact`: string fields with length constraints
  - `mitigations`: array of 0-10 suggestions
- Response parsed only if valid JSON matching schema
- Invalid JSON raises `422 Unprocessable Entity`

### ✓ Latency & Cost
- **Access check**: ~800ms (initial model load)
- **Typical request**: 200-600ms (Bedrock invocation) + 100-200ms (HTTP)
- **Per-call cost**: ~$0.0008 (150 input + 200 output tokens)

### ✓ Failure Modes (For SCRUM-141 Degradation)
| Scenario | HTTP Status | Error Header | Recovery |
|----------|-------------|--------------|----------|
| Timeout (no response in 5s) | 503 | (none) | Retry with longer timeout |
| Model not in region | 503 | `X-Fallback-Region: us-east-1` | Try fallback region |
| Access denied | 503 | (check IAM) | Verify credentials/permissions |
| Malformed response | 502 | (validation failed) | Retry or escalate |

## Configuration

### Environment Variables
- `AWS_REGION` — AWS region for Bedrock (default: `ap-southeast-1`)
- `BEDROCK_MODEL_ID` — Model to use (default: Claude 3.5 Sonnet)

### AWS Credentials
Uses default credential chain:
1. `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`
2. IAM role (if running on EC2/ECS)
3. `~/.aws/credentials`
4. Cognito identity provider

Set up locally:
```bash
aws configure
# or
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
```

## Testing Locally

### Unit and Integration Tests (Forecast Service)
```bash
# Python 3.11+ with the checksum-locked development dependencies
pip install -r requirements.txt
python -m pytest -q test_forecast.py tests
```

### Integration Test (via Spring Boot)
```bash
# Terminal 1: start FastAPI with a reviewed, checksum-pinned model bundle
python app.py

# Terminal 2: start the backend with FORECAST_BASE_URL pointing to FastAPI
cd ../backend && ./mvnw spring-boot:run

# Terminal 3: call the site-authorized backend door with a valid bearer token
curl -H "Authorization: Bearer <token>" \
  "http://localhost:8080/api/v1/sites/<site-id>/weather/forecast?horizonMinutes=30"
```

## Production Deployment

### Considerations
1. **Authentication**: Add API key or mTLS for backend calls
2. **Rate Limiting**: Limit to ~10 req/min per supervisor
3. **Monitoring**: Add CloudWatch logs and error metrics
4. **Timeout**: Set to 5-10 seconds (Bedrock can be slow)
5. **Fallback Region**: Document us-east-1 as fallback if ap-southeast-1 unavailable
6. **Cost Tracking**: Monitor token usage via Bedrock console

### Deployment Steps
1. Verify Bedrock access via `/bedrock/access` endpoint
2. Test round-trip via Spring Boot client
3. Set up CloudWatch alarms for error rates
4. Configure autoscaling for high load
5. Add caching layer (Redis) for common contexts

## Logs

The service logs important events for debugging:
```
INFO:     Bedrock startup: ✓ Bedrock model access confirmed in region=ap-southeast-1 (latency=0.85s)
INFO:     Bedrock invocation: latency=234ms, suggestions=2, tokens≈150
INFO:     Round-trip: 456ms (bedrock=234ms), suggestions=2, tokens≈150
ERROR:    ✗ Model not available in ap-southeast-1. Try us-east-1 as fallback.
ERROR:    Failed to parse Bedrock response: json.JSONDecodeError
```

## SCRUM-187: Bedrock Spike Acceptance Criteria Checklist

- ✅ **Model access confirmed in writing**: See `/bedrock/access` endpoint (documented in response)
- ✅ **Documented round-trip with schema-valid object**: POST `/bedrock/suggest` returns Pydantic-validated `MitigationBatch`
- ✅ **Timeout behavior demonstrated**: 5s timeout with typed exception (`BedrockTimeoutException`)
- ✅ **Failure mode documented**: All error codes documented in responses for SCRUM-141 degradation
- ✅ **Latency and cost recorded**: Logged on every invocation; documented in README
- ✅ **No out-of-scope features**: No agents, no tool calling, no prompt engineering

## SCRUM-188: Forecast Service Contract and Baseline Stub Acceptance Criteria

- ✅ **Contract committed and reviewed**: HTTP contract defined in `models.py` (ForecastRequest, ForecastPrediction)
- ✅ **Versioned baseline prediction**: Every prediction includes `model_version` field for traceability (US-06)
- ✅ **Persistence baseline implemented**: Naive forecast (next value = current) in `forecast_service.py`
- ✅ **Endpoint returns valid predictions**: POST `/forecast` returns Pydantic-validated `ForecastPrediction`
- ✅ **Backend consumes end-to-end**: Contract supports 30/60-min horizons, confidence intervals, model version
- ✅ **Replacing stub requires no change**: Contract is versioned; trained model (SCRUM-114) swaps without interface change
- ✅ **Tested locally**: 20 tests (11 forecast-specific + 9 integration) all passing in Docker
- ✅ **Honest comparison point**: Persistence baseline is the baseline US-06 requires ("baselines measured")

## References

- AWS Bedrock: https://docs.aws.amazon.com/bedrock/
- Claude 3.5: https://docs.anthropic.com/claude/
- Structured Output: https://docs.anthropic.com/claude/guides/structured-output
- Plan: `../docs/plans/SCRUM-187-bedrock-spike-plan.md`
- Runbook: `../docs/runbooks/SCRUM-187-bedrock-spike.md`
