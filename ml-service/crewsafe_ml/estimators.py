"""Small, auditable estimators used by the WBGT training pipeline."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, RegressorMixin, clone
from sklearn.utils.validation import check_is_fitted


def apply_persistence_floor(
    model_predictions: Any,
    current_wbgt: Any,
) -> np.ndarray:
    """Never return a forecast below the latest observed WBGT."""

    predictions = np.asarray(model_predictions, dtype=float)
    current_values = np.asarray(current_wbgt, dtype=float)
    if predictions.ndim != 1 or predictions.shape != current_values.shape:
        raise ValueError("predictions and current WBGT must be matching one-dimensional arrays")
    if not np.isfinite(predictions).all() or not np.isfinite(current_values).all():
        raise ValueError("predictions and current WBGT must contain only finite values")
    return np.maximum(predictions, current_values)


class PersistenceFloorRegressor(RegressorMixin, BaseEstimator):
    """Wrap a regressor with a conservative current-WBGT prediction floor."""

    def __init__(self, regressor: Any, current_column: str = "wbgt_t") -> None:
        self.regressor = regressor
        self.current_column = current_column

    def fit(self, features: pd.DataFrame, target: Any) -> PersistenceFloorRegressor:
        """Clone and fit the wrapped model without changing the caller's model."""

        _current_wbgt(features, self.current_column)
        self.regressor_ = clone(self.regressor)
        self.regressor_.fit(features, target)
        return self

    def predict(self, features: pd.DataFrame) -> np.ndarray:
        """Return the warmer of the trained forecast and the current WBGT."""

        check_is_fitted(self, "regressor_")
        current_wbgt = _current_wbgt(features, self.current_column)
        model_predictions = self.regressor_.predict(features)
        return apply_persistence_floor(model_predictions, current_wbgt)


def _current_wbgt(features: pd.DataFrame, column: str) -> np.ndarray:
    if not isinstance(features, pd.DataFrame):
        raise ValueError("persistence-floor features must be a pandas DataFrame")
    if column not in features.columns:
        raise ValueError(f"persistence-floor features are missing {column}")
    current_wbgt = pd.to_numeric(features[column], errors="coerce").to_numpy(dtype=float)
    if not np.isfinite(current_wbgt).all():
        raise ValueError("current WBGT must contain only finite values")
    return current_wbgt
