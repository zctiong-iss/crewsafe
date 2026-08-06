"""Forecast service with persistence baseline implementation."""
import logging
from typing import Tuple
from models import ForecastPrediction

logger = logging.getLogger(__name__)

# Model version for versioned predictions
MODEL_VERSION = "baseline-1.0.0"

# Confidence interval width for baseline (±2.5% of predicted value)
CONFIDENCE_INTERVAL_PERCENTAGE = 2.5


class ForecastService:
    """Persistence baseline forecaster: next value equals current value."""

    @staticmethod
    def forecast(
        metric: str,
        current_value: float,
        horizon_minutes: int = 30,
    ) -> ForecastPrediction:
        """
        Generate a versioned baseline forecast using persistence.

        The persistence baseline (naive model) assumes the next value equals
        the current value. This is the honest comparison point for ML models
        and satisfies SCRUM-114 requirement to beat this baseline.

        Args:
            metric: Metric being predicted (wbgt, temperature, humidity)
            current_value: Current observed value
            horizon_minutes: Forecast horizon in minutes (30 or 60)

        Returns:
            ForecastPrediction with versioned baseline prediction and confidence interval
        """
        # Persistence baseline: prediction = current value
        predicted_value = current_value

        # Confidence interval: ±2.5% (reasonable for baseline)
        interval_width = abs(predicted_value) * (CONFIDENCE_INTERVAL_PERCENTAGE / 100)
        lower_bound = predicted_value - interval_width
        upper_bound = predicted_value + interval_width

        # Handle edge case where current_value is 0 or negative
        if predicted_value == 0:
            interval_width = 1.0
            lower_bound = -interval_width
            upper_bound = interval_width

        logger.info(
            f"Forecast: {metric}={predicted_value:.1f} (horizon={horizon_minutes}min, "
            f"version={MODEL_VERSION}, interval=[{lower_bound:.1f}, {upper_bound:.1f}])"
        )

        return ForecastPrediction(
            metric=metric,
            predicted_value=predicted_value,
            horizon_minutes=horizon_minutes,
            model_version=MODEL_VERSION,
            confidence_interval_lower=lower_bound,
            confidence_interval_upper=upper_bound,
        )
