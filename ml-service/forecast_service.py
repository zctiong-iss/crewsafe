"""Backward-compatible baseline and trained WBGT forecasting service."""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import datetime, timedelta, timezone

from crewsafe_ml.inference import (
    ForecastModelRegistry,
    ModelConfigurationError,
    ModelInferenceError,
)
from models import ForecastContext, ForecastPrediction

logger = logging.getLogger(__name__)

MODEL_VERSION = "baseline-1.0.0"
CONFIDENCE_INTERVAL_PERCENTAGE = 2.5
SUPPORTED_HORIZONS = (30, 60)
MAX_OBSERVATION_AGE = timedelta(minutes=45)
MAX_CLOCK_SKEW = timedelta(minutes=1)


class ForecastServiceError(RuntimeError):
    """Safe, typed failure that the HTTP boundary may expose."""

    code = "FORECAST_ERROR"
    public_message = "Forecast request could not be completed"

    def as_detail(self) -> dict[str, str]:
        return {"code": self.code, "message": self.public_message}


class ForecastInputError(ForecastServiceError):
    """Recent observations are invalid, unsupported, or stale."""

    code = "FORECAST_INPUT_INVALID"
    public_message = "Forecast context is invalid or stale"


class ForecastModelUnavailableError(ForecastServiceError):
    """No checksum-verified trained model is available."""

    code = "FORECAST_MODEL_UNAVAILABLE"
    public_message = "Trained forecast model is temporarily unavailable"


class ForecastInferenceError(ForecastServiceError):
    """The configured model failed while producing a prediction."""

    code = "FORECAST_INFERENCE_FAILED"
    public_message = "Trained forecast could not be produced"


class ForecastService:
    """Use a verified model when context exists, otherwise preserve the baseline."""

    def __init__(
        self,
        model_registry: ForecastModelRegistry | None = None,
        *,
        model_configuration_failed: bool = False,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._model_registry = model_registry
        self._model_configuration_failed = model_configuration_failed
        self._clock = clock or (lambda: datetime.now(timezone.utc))

    @classmethod
    def from_environment(cls) -> "ForecastService":
        """Load a checksum-pinned model bundle without exposing path details."""

        try:
            registry = ForecastModelRegistry.from_environment()
        except (ModelConfigurationError, OSError):
            logger.error("Configured WBGT model bundle could not be loaded")
            return cls(model_configuration_failed=True)
        return cls(registry)

    def forecast(
        self,
        metric: str,
        current_value: float,
        horizon_minutes: int = 30,
        context: ForecastContext | None = None,
    ) -> ForecastPrediction:
        """Return a trained WBGT result or the legacy persistence baseline."""

        if horizon_minutes not in SUPPORTED_HORIZONS:
            raise ValueError("horizon_minutes must be 30 or 60")
        if context is None:
            return self._persistence_forecast(metric, current_value, horizon_minutes)
        if metric != "wbgt":
            raise ForecastInputError
        if self._model_registry is None or self._model_configuration_failed:
            raise ForecastModelUnavailableError

        observations = self._validated_observations(context, current_value)
        try:
            model_prediction = self._model_registry.predict(
                horizon_minutes=horizon_minutes,
                observations=observations,
                station_id=context.station_id,
                latitude=context.latitude,
                longitude=context.longitude,
            )
        except ValueError as error:
            raise ForecastInputError from error
        except (ModelConfigurationError, ModelInferenceError, OSError) as error:
            raise ForecastInferenceError from error

        logger.info(
            "Trained forecast: metric=%s horizon=%s version=%s",
            metric,
            horizon_minutes,
            model_prediction.model_version,
        )
        return ForecastPrediction(
            metric=metric,
            predicted_value=model_prediction.predicted_value,
            horizon_minutes=horizon_minutes,
            model_version=model_prediction.model_version,
            confidence_interval_lower=(
                model_prediction.predicted_value - model_prediction.interval_half_width
            ),
            confidence_interval_upper=(
                model_prediction.predicted_value + model_prediction.interval_half_width
            ),
        )

    def _validated_observations(
        self,
        context: ForecastContext,
        current_value: float,
    ) -> list[dict[str, object]]:
        observations = context.observations
        timestamps = [observation.observed_at for observation in observations]
        if any(timestamp.tzinfo is None for timestamp in timestamps):
            raise ForecastInputError

        utc_timestamps = [timestamp.astimezone(timezone.utc) for timestamp in timestamps]
        if utc_timestamps != sorted(utc_timestamps) or len(set(utc_timestamps)) != len(
            utc_timestamps
        ):
            raise ForecastInputError
        if any(
            timestamp.minute % 15 or timestamp.second or timestamp.microsecond
            for timestamp in utc_timestamps
        ):
            raise ForecastInputError

        latest_time = utc_timestamps[-1]
        now = self._clock().astimezone(timezone.utc)
        if latest_time > now + MAX_CLOCK_SKEW or now - latest_time > MAX_OBSERVATION_AGE:
            raise ForecastInputError

        latest_wbgt = observations[-1].wbgt
        if latest_wbgt is None or abs(latest_wbgt - current_value) > 0.05:
            raise ForecastInputError
        return [observation.model_dump() for observation in observations]

    @staticmethod
    def _persistence_forecast(
        metric: str,
        current_value: float,
        horizon_minutes: int,
    ) -> ForecastPrediction:
        """Predict that the next value equals the latest observed value."""

        interval_width = abs(current_value) * (CONFIDENCE_INTERVAL_PERCENTAGE / 100)
        if current_value == 0:
            interval_width = 1.0

        logger.info(
            "Persistence forecast: metric=%s value=%.1f horizon=%s version=%s",
            metric,
            current_value,
            horizon_minutes,
            MODEL_VERSION,
        )
        return ForecastPrediction(
            metric=metric,
            predicted_value=current_value,
            horizon_minutes=horizon_minutes,
            model_version=MODEL_VERSION,
            confidence_interval_lower=current_value - interval_width,
            confidence_interval_upper=current_value + interval_width,
        )
