"""SHAP-based driver importance for the trained WBGT model (SCRUM-152).

Computed once per horizon at training time and stored in the model manifest,
matching how every other expensive metric in this pipeline is pre-computed
rather than recomputed per inference request (see evaluation.py).
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
import shap
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.pipeline import Pipeline

# Bounds SHAP's cost on a validation split that can run to hundreds of thousands
# of rows. TreeExplainer scales with sample count, and driver ranking does not
# need the full split to be stable.
MAX_SHAP_SAMPLE_ROWS = 5000
SHAP_SAMPLE_SEED = 114
TOP_DRIVER_COUNT = 15


def compute_shap_drivers(
    model: Any,
    validation_features: pd.DataFrame,
    *,
    top_n: int = TOP_DRIVER_COUNT,
) -> list[dict[str, Any]]:
    """Rank input features by mean absolute SHAP value, or [] if not applicable.

    Only supports the tree-based candidates this pipeline actually trains
    (`HistGradientBoostingRegressor`, optionally wrapped in
    `PersistenceFloorRegressor`). Ridge and the bare persistence baseline have
    no tree to explain and return an empty list rather than raising - an
    unsupported selected model is not a training failure.

    Caveat that matters for anyone reading the output: when the selected model
    is persistence-floor-wrapped, these values explain the boosted-tree
    component only. The floor (`max(tree_prediction, current_wbgt)`) is applied
    after the explained model, so on a floor-triggered prediction the real
    driver - the current WBGT reading - will not show up here the way it
    drove the actual output.
    """

    extracted = _extract_preprocessed_tree_model(model)
    if extracted is None:
        return []
    preprocess, tree_model = extracted

    sample = validation_features
    if len(sample) > MAX_SHAP_SAMPLE_ROWS:
        sample = sample.sample(
            n=MAX_SHAP_SAMPLE_ROWS,
            random_state=SHAP_SAMPLE_SEED,
        )

    preprocessed = preprocess.transform(sample)
    feature_names = list(preprocess.get_feature_names_out())

    explainer = shap.TreeExplainer(tree_model)
    shap_values = np.asarray(explainer.shap_values(preprocessed))
    mean_abs_by_column = np.abs(shap_values).mean(axis=0)

    aggregated = _aggregate_by_base_feature(feature_names, mean_abs_by_column)
    ranked = sorted(aggregated.items(), key=lambda item: item[1], reverse=True)
    return [
        {"feature": feature, "mean_abs_shap": float(value)}
        for feature, value in ranked[:top_n]
    ]


def _extract_preprocessed_tree_model(model: Any) -> tuple[Any, HistGradientBoostingRegressor] | None:
    """Unwrap a fitted candidate to its preprocessing step and boosted-tree model."""

    inner = model
    if hasattr(inner, "regressor_"):
        # A fitted PersistenceFloorRegressor.
        inner = inner.regressor_
    if not isinstance(inner, Pipeline):
        return None
    tree_model = inner.named_steps.get("model")
    preprocess = inner.named_steps.get("preprocess")
    if not isinstance(tree_model, HistGradientBoostingRegressor) or preprocess is None:
        return None
    return preprocess, tree_model


def _aggregate_by_base_feature(
    feature_names: list[str],
    mean_abs_values: np.ndarray,
) -> dict[str, float]:
    """Collapse one-hot and missingness-indicator columns back to a named driver.

    `station_id_S124`, `station_id_S125`, ... are one encoded feature, not
    dozens - splitting importance across every station code would bury a real
    driver behind its own cardinality. Missingness indicators are kept as
    their own driver (whether a reading was missing is itself informative)
    but named after the feature they describe rather than the imputer's
    internal prefix.
    """

    aggregated: dict[str, float] = {}
    for name, value in zip(feature_names, mean_abs_values):
        base = _base_feature_name(name)
        aggregated[base] = aggregated.get(base, 0.0) + float(value)
    return aggregated


def _base_feature_name(name: str) -> str:
    if name.startswith("station_id_"):
        return "station_id"
    if name.startswith("missingindicator_"):
        return name.removeprefix("missingindicator_") + "_missing_indicator"
    return name
