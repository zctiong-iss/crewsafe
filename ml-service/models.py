"""Pydantic models for Bedrock mitigation spike and forecast service."""
from pydantic import BaseModel, Field
from typing import List, Literal, Optional
from datetime import datetime


class Timing(BaseModel):
    """Duration / recurrence / deadline for a mitigation that needs one.

    Not every action needs this (e.g. CLOSE_MONITORING has no duration), so the whole
    object is optional on MitigationSuggestion — but any field present on it must be
    well-formed if given.
    """
    durationMinutes: Optional[int] = Field(None, ge=1, description="How long the action lasts, in minutes")
    everyMinutes: Optional[int] = Field(None, ge=1, description="How often it recurs, in minutes")
    startByUtc: Optional[str] = Field(None, description="ISO 8601 deadline to start by")


class MitigationSuggestion(BaseModel):
    """Single mitigation suggestion with structured constraints.

    actionCode/category/origin/ruleReference are required: unlike the backend's Java
    record (which made actionCode/category nullable to keep old database rows loading),
    this model validates a live model response, and a candidate that fails to produce
    one of these fields is exactly the failure §8.6 exists to catch.

    appliesTo stays optional, matching the SCRUM-288 cross-schema agreement: absent
    means "applies to the whole shift," not "unknown."
    """
    priority: str = Field(..., pattern="^(HIGH|MEDIUM|LOW)$", description="Priority level")
    action: str = Field(..., min_length=1, max_length=200, description="Mitigation action")
    rationale: str = Field(..., min_length=1, max_length=500, description="Why this is recommended")
    estimatedImpact: str = Field(..., min_length=1, max_length=200, description="Expected impact")
    actionCode: str = Field(..., min_length=1, description="Allowlist code, e.g. REST_15_MIN_HOURLY")
    category: str = Field(..., min_length=1, description="Topic grouping, e.g. REST, HYDRATION")
    origin: str = Field(..., pattern="^(MANDATORY|ADVISORY)$", description="Whether a supervisor may remove this")
    ruleReference: str = Field(..., min_length=1, description="Policy rule that justified this action")
    appliesTo: Optional[List[str]] = Field(None, description="Worker UUIDs; omitted means the whole shift")
    timing: Optional[Timing] = Field(None, description="Duration/recurrence/deadline, when applicable")

    class Config:
        json_schema_extra = {
            "example": {
                "priority": "HIGH",
                "action": "Rest 15 minutes in shade every hour",
                "rationale": "WBGT at 35°C exceeds safe limits for continuous work",
                "estimatedImpact": "10-15% reduction in heat stress risk",
                "actionCode": "REST_15_MIN_HOURLY",
                "category": "REST",
                "origin": "MANDATORY",
                "ruleReference": "HS-33-HEAVY",
                "appliesTo": ["w-1", "w-3"],
                "timing": {"durationMinutes": 15, "everyMinutes": 60}
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
                        "action": "Rest 15 minutes in shade every hour",
                        "rationale": "WBGT critical",
                        "estimatedImpact": "15% reduction",
                        "actionCode": "REST_15_MIN_HOURLY",
                        "category": "REST",
                        "origin": "MANDATORY",
                        "ruleReference": "HS-33-HEAVY",
                        "appliesTo": ["w-1"],
                        "timing": {"durationMinutes": 15, "everyMinutes": 60}
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
    horizon_minutes: Literal[30, 60] = Field(
        default=30,
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
