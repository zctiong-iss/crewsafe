"""Pydantic models for Bedrock mitigation spike and forecast service."""
from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing import List, Literal, Optional
from datetime import datetime, timezone

# Shared across ForecastPrediction/ModelStatus/ModelCard example payloads (python:S1192).
_BASELINE_MODEL_VERSION_EXAMPLE = "baseline-1.0.0"


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


class ForecastObservation(BaseModel):
    """One timestamped weather observation used by the trained WBGT model."""

    model_config = ConfigDict(extra="forbid")

    observed_at: datetime = Field(..., description="UTC observation time")
    wbgt: Optional[float] = Field(None, ge=0, le=60)
    air_temperature: Optional[float] = Field(None, ge=-10, le=60)
    relative_humidity: Optional[float] = Field(None, ge=0, le=100)
    wind_speed: Optional[float] = Field(None, ge=0, le=100)
    wind_direction: Optional[float] = Field(None, ge=0, le=360)
    rainfall: Optional[float] = Field(None, ge=0, le=500)


class ForecastContext(BaseModel):
    """Recent site readings required for trained WBGT inference."""

    model_config = ConfigDict(extra="forbid")

    station_id: str = Field(
        ...,
        min_length=1,
        max_length=100,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
    )
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    observations: List[ForecastObservation] = Field(..., min_length=2, max_length=16)


class ForecastRequest(BaseModel):
    """Backward-compatible request for baseline or trained forecasting."""

    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "example": {
                "metric": "wbgt",
                "horizon_minutes": 30,
                "current_value": 35.5,
                "context": None,
            }
        },
    )

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
        description="Current value of the metric"
    )
    context: Optional[ForecastContext] = Field(
        None,
        description=(
            "Recent timestamped readings for trained WBGT inference. When omitted, "
            "the existing persistence contract is used."
        ),
    )

    @model_validator(mode="after")
    def validate_metric_value(self) -> "ForecastRequest":
        """Apply the physical range belonging to the requested metric."""

        ranges = {
            "wbgt": (0, 60),
            "temperature": (-10, 60),
            "humidity": (0, 100),
        }
        minimum, maximum = ranges[self.metric]
        if not minimum <= self.current_value <= maximum:
            raise ValueError(f"current_value must be between {minimum} and {maximum}")
        if self.context is not None and self.metric != "wbgt":
            raise ValueError("forecast context is supported only for WBGT")
        return self

class ForecastPrediction(BaseModel):
    """Versioned forecast prediction conforming to committed contract."""

    model_config = ConfigDict(
        protected_namespaces=(),
        json_schema_extra={
            "example": {
                "metric": "wbgt",
                "predicted_value": 35.5,
                "horizon_minutes": 30,
                "model_version": _BASELINE_MODEL_VERSION_EXAMPLE,
                "confidence_interval_lower": 34.2,
                "confidence_interval_upper": 36.8,
                "timestamp": "2026-02-08T12:00:00Z",
            }
        },
    )

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
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="Prediction generation time in UTC",
    )


class ModelHorizonMetrics(BaseModel):
    """Accuracy metrics for one forecast horizon, taken from the evaluation artifact."""

    model_config = ConfigDict(extra="forbid")

    mae: float = Field(..., description="Mean absolute error")
    rmse: float = Field(..., description="Root mean squared error")
    mean_bias: float = Field(..., description="Mean signed error (predicted minus actual)")
    macro_f1: float = Field(..., description="Macro-averaged F1 across WBGT risk bands")
    recall_at_least_32: float = Field(..., description="Recall for actual WBGT >= 32 degrees")
    recall_at_least_33: float = Field(..., description="Recall for actual WBGT >= 33 degrees")
    mae_by_actual_band: dict[str, Optional[float]] = Field(
        ..., description="Mean absolute error grouped by actual WBGT risk band"
    )
    confusion_matrix: List[List[int]] = Field(
        ..., description="Risk-band confusion matrix, ordered BELOW_31..AT_LEAST_33"
    )
    sample_count: int = Field(..., description="Number of evaluation samples backing these metrics")


class ModelStatus(BaseModel):
    """Currently configured model's approval status and per-horizon accuracy metrics."""

    model_config = ConfigDict(
        protected_namespaces=(),
        json_schema_extra={
            "example": {
                "model_version": _BASELINE_MODEL_VERSION_EXAMPLE,
                "approved_for_inference": False,
                "approval_blocker": "no model configured",
                "horizons": {},
            }
        },
    )

    model_version: str = Field(..., description="Currently configured model bundle version")
    approved_for_inference: bool = Field(
        ..., description="Whether the configured bundle is approved for production inference"
    )
    approval_blocker: Optional[str] = Field(
        None, description="Why the bundle is not approved, when applicable"
    )
    horizons: dict[str, ModelHorizonMetrics] = Field(
        default_factory=dict,
        description="Evaluation metrics per horizon (keys '30'/'60'), from the model manifest",
    )


class ShapDriver(BaseModel):
    """One input feature's mean absolute SHAP contribution for a horizon."""

    model_config = ConfigDict(extra="forbid")

    feature: str = Field(..., description="Feature name (one-hot/indicator columns collapsed)")
    mean_abs_shap: float = Field(..., description="Mean absolute SHAP value across the validation sample")


class HorizonCalibration(BaseModel):
    """Whether the stated confidence interval matches real-world coverage."""

    model_config = ConfigDict(extra="forbid")

    target_coverage: float = Field(..., description="Coverage the interval was calibrated to, e.g. 0.95")
    final_test_coverage: float = Field(
        ..., description="Actual coverage measured on the held-out test window"
    )
    calibration_sample_count: int = Field(
        ..., description="Validation samples used to calibrate the interval"
    )


class ModelCardHorizon(BaseModel):
    """Explainability and reliability data for one forecast horizon."""

    model_config = ConfigDict(extra="forbid")

    shap_drivers: List[ShapDriver] = Field(
        default_factory=list,
        description="Top drivers by mean absolute SHAP value, most important first",
    )
    shap_computed: bool = Field(
        ..., description="False when this model bundle predates SHAP computation or has no tree to explain"
    )
    calibration: Optional[HorizonCalibration] = Field(
        None, description="Stated-vs-actual confidence interval coverage, when available"
    )
    mae_by_actual_band: dict[str, Optional[float]] = Field(
        ..., description="Mean absolute error grouped by actual WBGT risk band"
    )


class ModelCard(BaseModel):
    """Explainability and reliability report for the configured model (SCRUM-152)."""

    model_config = ConfigDict(
        protected_namespaces=(),
        json_schema_extra={
            "example": {
                "model_version": _BASELINE_MODEL_VERSION_EXAMPLE,
                "horizons": {},
            }
        },
    )

    model_version: str = Field(..., description="Currently configured model bundle version")
    horizons: dict[str, ModelCardHorizon] = Field(
        default_factory=dict,
        description="Model card data per horizon (keys '30'/'60')",
    )
