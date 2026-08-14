"""Evaluation metrics and safety-aware model acceptance rules."""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
from sklearn.metrics import (
    confusion_matrix,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    recall_score,
)


WBGT_BAND_LABELS = (
    "BELOW_31",
    "FROM_31_TO_32",
    "FROM_32_TO_33",
    "AT_LEAST_33",
)


@dataclass(frozen=True)
class ForecastMetrics:
    mae: float
    rmse: float
    mean_bias: float
    macro_f1: float
    recall_at_least_32: float
    recall_at_least_33: float
    mae_by_actual_band: dict[str, float | None]
    confusion_matrix: list[list[int]]
    sample_count: int

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


def evaluate_predictions(actual: np.ndarray, predicted: np.ndarray) -> ForecastMetrics:
    """Measure regression accuracy and operational WBGT-band performance."""

    actual = np.asarray(actual, dtype=float)
    predicted = np.asarray(predicted, dtype=float)
    if actual.shape != predicted.shape or actual.ndim != 1 or actual.size == 0:
        raise ValueError("actual and predicted must be non-empty one-dimensional arrays")
    if not np.isfinite(actual).all() or not np.isfinite(predicted).all():
        raise ValueError("actual and predicted must contain only finite values")

    actual_bands = wbgt_bands(actual)
    predicted_bands = wbgt_bands(predicted)
    actual_32 = actual >= 32.0
    predicted_32 = predicted >= 32.0
    actual_33 = actual >= 33.0
    predicted_33 = predicted >= 33.0
    absolute_errors = np.abs(predicted - actual)
    return ForecastMetrics(
        mae=float(mean_absolute_error(actual, predicted)),
        rmse=float(mean_squared_error(actual, predicted) ** 0.5),
        mean_bias=float(np.mean(predicted - actual)),
        macro_f1=float(
            f1_score(
                actual_bands,
                predicted_bands,
                labels=WBGT_BAND_LABELS,
                average="macro",
                zero_division=0,
            )
        ),
        recall_at_least_32=float(recall_score(actual_32, predicted_32, zero_division=0)),
        recall_at_least_33=float(recall_score(actual_33, predicted_33, zero_division=0)),
        mae_by_actual_band={
            label: (
                float(np.mean(absolute_errors[actual_bands == label]))
                if np.any(actual_bands == label)
                else None
            )
            for label in WBGT_BAND_LABELS
        },
        confusion_matrix=confusion_matrix(
            actual_bands,
            predicted_bands,
            labels=WBGT_BAND_LABELS,
        ).tolist(),
        sample_count=int(actual.size),
    )


def wbgt_bands(values: np.ndarray) -> np.ndarray:
    values = np.asarray(values, dtype=float)
    return np.select(
        [values < 31.0, values < 32.0, values < 33.0],
        [WBGT_BAND_LABELS[0], WBGT_BAND_LABELS[1], WBGT_BAND_LABELS[2]],
        default=WBGT_BAND_LABELS[3],
    )


def meets_acceptance_rule(
    candidate: ForecastMetrics,
    persistence: ForecastMetrics,
) -> bool:
    """Require lower MAE without sacrificing either high-risk recall measure."""

    return (
        candidate.mae < persistence.mae
        and candidate.recall_at_least_32 >= persistence.recall_at_least_32
        and candidate.recall_at_least_33 >= persistence.recall_at_least_33
    )
