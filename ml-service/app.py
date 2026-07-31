"""Minimal FastAPI endpoint for Bedrock spike."""
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import time

from bedrock_client import BedrockClient, BedrockAccessError, BedrockModelAccessError
from models import MitigationRequest, MitigationBatch

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Bedrock client at startup
bedrock_client: BedrockClient = None


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


@app.post("/bedrock/suggest", response_model=MitigationBatch)
async def suggest_mitigations(request: MitigationRequest):
    """
    Generate mitigation suggestions via Bedrock with structured output.

    Returns Pydantic-validated MitigationBatch proving schema enforcement.
    """
    if bedrock_client is None:
        raise HTTPException(status_code=503, detail="Bedrock client not initialized")

    start_time = time.time()

    try:
        batch, latency_ms, tokens = bedrock_client.invoke(
            context=request.context,
            model_id=request.model_id,
            max_tokens=request.max_tokens,
            temperature=request.temperature,
        )

        # Log round-trip
        total_ms = (time.time() - start_time) * 1000
        logger.info(
            f"Round-trip: {total_ms:.0f}ms (bedrock={latency_ms:.0f}ms), "
            f"suggestions={len(batch.mitigations)}, tokens≈{tokens}"
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
        raise HTTPException(status_code=502, detail=f"Invalid response from Bedrock: {str(e)}")
    except Exception as e:
        logger.exception(f"Unexpected error: {e}")
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
