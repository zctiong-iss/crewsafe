"""Minimal FastAPI endpoint for Bedrock spike."""
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from agent.contract import AgentDraftRequest, AgentDraftResponse
from agent.graph import draft_plan, set_bedrock_client
from bedrock_client import BedrockClient, BedrockAccessError, BedrockModelAccessError
from models import MitigationRequest, MitigationBatch, ForecastRequest, ForecastPrediction
from forecast_service import ForecastService, ForecastServiceError

# Selected in SCRUM-287 against the §8.6 evaluation set. Kept in sync with the backend's
# app.bedrock.model-id, which is the same value with the same BEDROCK_MODEL_ID override.
DEFAULT_MODEL_ID = "global.anthropic.claude-haiku-4-5-20251001-v1:0"

# One constant rather than the same literal repeated at every catch-all (python:S1192).
# The text is deliberately generic: an exception message routinely carries a file path, a
# class name, or request data, none of which belongs in an HTTP response body.
INTERNAL_SERVER_ERROR = "Internal server error"

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Optional, not BedrockClient: it really is None until lifespan() runs, and every endpoint
# below checks for that. Declaring the non-optional type made a null-safety bug invisible
# to type checkers (python:S5890).
bedrock_client: Optional[BedrockClient] = None
forecast_service = ForecastService.from_environment()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: verify Bedrock access. Shutdown: cleanup."""
    global bedrock_client

    region = os.getenv("AWS_REGION", "ap-southeast-1")
    bedrock_client = BedrockClient(region=region)

    try:
        _, message = bedrock_client.verify_access()
        logger.info("Bedrock startup: %s", message)
    except BedrockAccessError:
        # exception() rather than warning(): this is the one place the startup failure's
        # traceback is recoverable, and a Bedrock outage at boot is worth the full context.
        logger.exception("Bedrock not accessible at startup")

    # The agent graph shares this client rather than building a second one, so it inherits the
    # startup access check and its cached result. A client that failed verification is still
    # handed over on purpose: the graph's fallback path is what turns that into a plan, and
    # refusing to register it here would turn a recoverable outage into a 503.
    set_bedrock_client(bedrock_client)

    yield

    # Cleanup
    if bedrock_client and bedrock_client.client:
        bedrock_client.client.close()


app = FastAPI(
    title="CrewSafe Bedrock Spike",
    description="Minimal FastAPI endpoint for SCRUM-187 spike verification",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS for local testing
app.add_middleware(
    CORSMiddleware,
    allow_origins=["localhost", "127.0.0.1", "http://localhost:8080"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok"}


@app.get(
    "/bedrock/access",
    responses={
        200: {"description": "Bedrock model access confirmed in the configured region"},
        503: {"description": "Bedrock is unreachable, or its client has not been initialised"},
    },
)
async def verify_bedrock_access():
    """Verify Bedrock model access in the configured region.

    The failure path returns an explicit JSONResponse rather than a `(body, status)` tuple.
    FastAPI is not Flask: it has no tuple-to-status convention, so the old form serialised the
    pair into a two-element JSON array and answered **200 OK while Bedrock was broken** —
    exactly inverting what a health probe polling this endpoint is for.
    """
    if bedrock_client is None:
        raise HTTPException(status_code=503, detail="Bedrock client not initialized")

    try:
        success, message = bedrock_client.verify_access()
    except BedrockAccessError as e:
        detail = str(e)
        logger.exception("Bedrock access verification failed")
        return JSONResponse(
            status_code=503,
            content={
                "status": "error",
                "message": detail,
                "region": bedrock_client.region,
                "recommendation": (
                    "Try fallback region us-east-1"
                    if "not available" in detail
                    else "Check IAM permissions"
                ),
            },
        )

    return {
        "status": "ok" if success else "error",
        "message": message,
        "region": bedrock_client.region,
    }


@app.post(
    "/bedrock/suggest",
    response_model=MitigationBatch,
    responses={
        200: {"description": "Mitigation suggestions"},
        502: {"description": "Invalid response from Bedrock"},
        503: {"description": "Bedrock service unavailable, or its client is not initialised"},
        # The catch-all below really can return this, so the generated OpenAPI schema - which
        # clients are code-generated from - should say so (python:S8415).
        500: {"description": "Internal server error"},
    },
)
async def suggest_mitigations(request: MitigationRequest):
    """
    Generate mitigation suggestions via Bedrock with structured output.

    Returns Pydantic-validated MitigationBatch proving schema enforcement.
    """
    if bedrock_client is None:
        raise HTTPException(status_code=503, detail="Bedrock client not initialized")

    start_time = time.time()

    try:
        batch, latency_ms, input_tokens, output_tokens = bedrock_client.invoke(
            context=request.context,
            model_id=request.model_id,
            max_tokens=request.max_tokens,
            temperature=request.temperature,
        )

        # Log round-trip. Lazy %-formatting, matching every other log line in this module:
        # the arguments are only rendered if the level is actually enabled.
        total_ms = (time.time() - start_time) * 1000
        logger.info(
            "Round-trip: %.0fms (bedrock=%.0fms), suggestions=%d, tokens=%d+%d",
            total_ms, latency_ms, len(batch.mitigations), input_tokens, output_tokens,
        )

        return batch

    # Most specific first. BedrockModelAccessError subclasses BedrockAccessError, so with the
    # parent listed first this branch was unreachable dead code (python:S1045) and the
    # X-Fallback-Region header it exists to send could never actually be sent - a caller was
    # told "Bedrock is unavailable" with no hint that another region would work.
    except BedrockModelAccessError as e:
        logger.exception("Model not available")
        raise HTTPException(
            status_code=503,
            detail=f"{e} Fallback: try us-east-1",
            headers={"X-Fallback-Region": "us-east-1"},
        ) from e
    except BedrockAccessError as e:
        logger.exception("Bedrock access error")
        raise HTTPException(status_code=503, detail=str(e)) from e
    except ValueError as e:
        logger.exception("Response validation failed")
        raise HTTPException(status_code=502, detail="Invalid response from Bedrock") from e
    except Exception as e:
        logger.exception("Unexpected error")
        raise HTTPException(status_code=500, detail=INTERNAL_SERVER_ERROR) from e


@app.post(
    "/forecast",
    response_model=ForecastPrediction,
    responses={
        200: {"description": "Versioned forecast prediction"},
        422: {"description": "Invalid forecast request parameters"},
        503: {"description": "Trained model unavailable or inference failed"},
        500: {"description": "Internal server error"},
    },
)
async def forecast(request: ForecastRequest):
    """
    Generate a versioned trained or baseline forecast.

    A WBGT request with recent context uses the checksum-verified trained model.
    Existing callers that send only the original three fields keep receiving the
    labelled persistence baseline, so the SCRUM-188 contract is not broken.

    Request contract:
    - metric: wbgt, temperature, or humidity
    - horizon_minutes: 30 or 60 minutes
    - current_value: current observed value

    Response contract:
    - predicted_value: forecast at horizon
    - model_version: traced version (currently baseline-1.0.0)
    - confidence_interval: 95% bounds for uncertainty
    - timestamp: prediction creation time (ISO 8601)

    Acceptance: Backend consumes end-to-end; replacing with trained model
    requires no consumer change.
    """
    start_time = time.time()

    try:
        prediction = forecast_service.forecast(
            metric=request.metric,
            current_value=request.current_value,
            horizon_minutes=request.horizon_minutes,
            context=request.context,
        )

        latency_ms = (time.time() - start_time) * 1000
        logger.info(
            "Forecast completed: metric=%s horizon=%s latency_ms=%.1f version=%s",
            request.metric,
            request.horizon_minutes,
            latency_ms,
            prediction.model_version,
        )

        return prediction

    except ForecastServiceError as error:
        # Stays warning(), not exception(): a degraded forecast is an expected §7.1 outcome
        # (no model bundle, stale readings, wrong cadence), not a fault worth a traceback.
        logger.warning("Forecast request failed safely: code=%s", error.code)
        status_code = 422 if error.code == "FORECAST_INPUT_INVALID" else 503
        raise HTTPException(status_code=status_code, detail=error.as_detail()) from error
    except ValueError as error:
        logger.warning("Forecast request failed validation")
        raise HTTPException(
            status_code=422, detail="Invalid forecast request parameters"
        ) from error
    except Exception as error:
        # Deliberately error() without the traceback, NOT exception(). This is the one
        # catch-all in the module that must not record exception text: a model path, a
        # checksum, or weather context can appear in it, and test_forecast.py's
        # test_unexpected_forecast_error_does_not_leak_details asserts that none of it
        # reaches the log. Sonar's python:S8572 does not flag this line precisely because
        # it logs no exception detail to lose in the first place.
        logger.error("Forecast inference failed")
        raise HTTPException(status_code=500, detail=INTERNAL_SERVER_ERROR) from error


@app.post(
    "/agent/draft",
    response_model=AgentDraftResponse,
    responses={
        200: {"description": "A draft plan, from either the model or the deterministic fallback"},
        422: {"description": "Malformed request (missing policy decision, bad band name, ...)"},
        500: {"description": "Internal server error"},
    },
)
async def agent_draft(request: AgentDraftRequest):
    """Turn a policy decision into an explainable draft plan (SCRUM-118 / SCRUM-289).

    Deliberately has no 503. Bedrock being unavailable, throttled, or wrong is not an error
    condition for this endpoint — the graph's fallback node turns every one of those into a
    valid deterministic plan, and the caller reads `usedFallback` to find out which path ran.
    A supervisor asking for a plan during a heat event gets a plan.

    The one thing this endpoint will not do is invent a policy decision. `policyDecision` is a
    required field, so a request that skipped policy evaluation fails validation at the door
    with a 422 rather than reaching the model (§8.2).
    """
    model_id = os.getenv("BEDROCK_MODEL_ID", DEFAULT_MODEL_ID)
    start_time = time.time()

    try:
        response = draft_plan(request, model_id=model_id)
    except Exception as error:
        logger.exception("Agent draft failed outside the graph's own fallback path")
        raise HTTPException(status_code=500, detail=INTERNAL_SERVER_ERROR) from error

    logger.info(
        "agent_draft_completed shift=%s mitigations=%d used_fallback=%s total_ms=%.0f tokens=%d+%d",
        request.shiftId, len(response.mitigations), response.usedFallback,
        (time.time() - start_time) * 1000, response.inputTokens, response.outputTokens,
    )
    return response


@app.get("/openapi.json")
async def openapi_schema():
    """OpenAPI schema for client code generation."""
    return app.openapi()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )
