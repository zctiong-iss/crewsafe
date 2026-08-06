"""Pydantic models for Bedrock mitigation spike and forecast service."""
from pydantic import BaseModel, Field
from typing import List, Literal
from datetime import datetime


class MitigationSuggestion(BaseModel):
    """Single mitigation suggestion with structured constraints."""
    priority: str = Field(..., pattern="^(HIGH|MEDIUM|LOW)$", description="Priority level")
    action: str = Field(..., min_length=1, max_length=200, description="Mitigation action")
    rationale: str = Field(..., min_length=1, max_length=500, description="Why this is recommended")
    estimatedImpact: str = Field(..., min_length=1, max_length=200, description="Expected impact")

    class Config:
        json_schema_extra = {
            "example": {
                "priority": "HIGH",
                "action": "Reduce work hours to 20 min active / 10 min rest",
                "rationale": "WBGT at 35°C exceeds safe limits for continuous work",
                "estimatedImpact": "10-15% reduction in heat stress risk"
            }
        }


class MitigationBatch(BaseModel):
    """Batch of mitigation suggestions returned from Bedrock."""
    mitigations: List[MitigationSuggestion] = Field(..., min_items=0, max_items=10)

    class Config:
        json_schema_extra = {
            "example": {
                "mitigations": [
                    {
                        "priority": "HIGH",
                        "action": "Reduce work hours",
                        "rationale": "WBGT critical",
                        "estimatedImpact": "15% reduction"
                    }
                ]
            }
        }


class MitigationRequest(BaseModel):
    """Request context for generating mitigations."""
    context: str = Field(..., min_length=10, max_length=2000, description="Weather and crew context")
    model_id: str = Field(default="anthropic.claude-3-5-sonnet-20241022-v2:0")
    max_tokens: int = Field(default=1024, ge=100, le=4096)
    temperature: float = Field(default=0.7, ge=0.0, le=1.0)

    class Config:
        json_schema_extra = {
            "example": {
                "context": "Current WBGT: 35°C, 60% humidity, 12 workers on site. Last water break 30 min ago."
            }
        }


class ForecastRequest(BaseModel):
    """Request for WBGT forecast prediction."""
    metric: str = Field(
        ...,
        pattern="^(wbgt|temperature|humidity)$",
        description="Metric to forecast (wbgt, temperature, or humidity)"
    )
    horizon_minutes: int = Field(
        default=30,
        ge=30,
        le=60,
        description="Forecast horizon in minutes (30 or 60)"
    )
    current_value: float = Field(
        ...,
        ge=-10,
        le=60,
        description="Current value of the metric"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "metric": "wbgt",
                "horizon_minutes": 30,
                "current_value": 35.5
            }
        }


class ForecastPrediction(BaseModel):
    """Versioned forecast prediction conforming to committed contract."""
    metric: str = Field(..., description="Metric being predicted")
    predicted_value: float = Field(..., description="Predicted value at horizon")
    horizon_minutes: int = Field(..., description="Time horizon for prediction")
    model_version: str = Field(..., description="Version of the model used")
    confidence_interval_lower: float = Field(
        ...,
        description="Lower bound of 95% confidence interval"
    )
    confidence_interval_upper: float = Field(
        ...,
        description="Upper bound of 95% confidence interval"
    )
    timestamp: datetime = Field(default_factory=datetime.utcnow, description="Prediction timestamp")

    class Config:
        json_schema_extra = {
            "example": {
                "metric": "wbgt",
                "predicted_value": 35.5,
                "horizon_minutes": 30,
                "model_version": "baseline-1.0.0",
                "confidence_interval_lower": 34.2,
                "confidence_interval_upper": 36.8,
                "timestamp": "2026-02-08T12:00:00"
            }
        }
