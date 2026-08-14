"""Minimal FastAPI endpoint for Bedrock spike."""
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import time

from bedrock_client import BedrockClient, BedrockAccessError, BedrockModelAccessError
from models import MitigationRequest, MitigationBatch, ForecastRequest, ForecastPrediction
from forecast_service import ForecastService, ForecastServiceError

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Bedrock client at startup
bedrock_client: BedrockClient = None
forecast_service = ForecastService.from_environment()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: verify Bedrock access. Shutdown: cleanup."""
    global bedrock_client

    region = os.getenv("AWS_REGION", "ap-southeast-1")
    bedrock_client = BedrockClient(region=region)

    try:
        success, message = bedrock_client.verify_access()
        logger.info(f"Bedrock startup: {message}")
    except BedrockAccessError as e:
        logger.warning(f"Bedrock not accessible at startup: {e}")

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


@app.get("/bedrock/access")
async def verify_bedrock_access():
    """Verify Bedrock model access in the configured region."""
    if bedrock_client is None:
        raise HTTPException(status_code=503, detail="Bedrock client not initialized")

    try:
        success, message = bedrock_client.verify_access()
        return {
            "status": "ok" if success else "error",
            "message": message,
            "region": bedrock_client.region,
        }
    except BedrockAccessError as e:
        return {
            "status": "error",
            "message": str(e),
            "region": bedrock_client.region,
            "recommendation": "Try fallback region us-east-1" if "not available" in str(e) else "Check IAM permissions",
        }, 503


@app.post(
    "/bedrock/suggest",
    response_model=MitigationBatch,
    responses={
        200: {"description": "Mitigation suggestions"},
        502: {"description": "Invalid response from Bedrock"},
        503: {"description": "Bedrock service unavailable"},
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

        # Log round-trip
        total_ms = (time.time() - start_time) * 1000
        logger.info(
            f"Round-trip: {total_ms:.0f}ms (bedrock={latency_ms:.0f}ms), "
            f"suggestions={len(batch.mitigations)}, tokens={input_tokens}+{output_tokens}"
        )

        return batch

    except BedrockAccessError as e:
        logger.error(f"Bedrock access error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except BedrockModelAccessError as e:
        logger.error(f"Model not available: {e}")
        raise HTTPException(
            status_code=503,
            detail=f"{str(e)} Fallback: try us-east-1",
            headers={"X-Fallback-Region": "us-east-1"},
        )
    except ValueError as e:
        logger.error(f"Response validation failed: {e}")
        raise HTTPException(status_code=502, detail="Invalid response from Bedrock")
    except Exception as e:
        logger.exception(f"Unexpected error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


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
        logger.warning("Forecast request failed safely: code=%s", error.code)
        status_code = 422 if error.code == "FORECAST_INPUT_INVALID" else 503
        raise HTTPException(status_code=status_code, detail=error.as_detail())
    except ValueError:
        logger.warning("Forecast request failed validation")
        raise HTTPException(status_code=422, detail="Invalid forecast request parameters")
    except Exception:
        logger.error("Forecast inference failed")
        raise HTTPException(status_code=500, detail="Internal server error")


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
