"""Versioned persistence baseline used by the committed forecast contract."""

import logging

from models import ForecastPrediction

logger = logging.getLogger(__name__)

MODEL_VERSION = "baseline-1.0.0"
CONFIDENCE_INTERVAL_PERCENTAGE = 2.5
SUPPORTED_HORIZONS = (30, 60)


class ForecastService:
    """Return a simple, deterministic baseline forecast."""

    @staticmethod
    def forecast(
        metric: str,
        current_value: float,
        horizon_minutes: int = 30,
    ) -> ForecastPrediction:
        """Predict that the next value equals the latest observed value."""

        if horizon_minutes not in SUPPORTED_HORIZONS:
            raise ValueError("horizon_minutes must be 30 or 60")

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
