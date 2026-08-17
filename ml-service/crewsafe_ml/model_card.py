"""Read-only reporting of the configured WBGT model's explainability and
calibration (SCRUM-152): SHAP driver importance, stated-vs-actual confidence
interval coverage, and per-risk-band error.

Same shape as model_status.py: reads the checksum-verified manifest, never
loads joblib artifacts, degrades honestly rather than erroring.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Mapping

from .inference import ModelConfigurationError, verified_manifest
from .model_status import BASELINE_MODEL_VERSION


def current_model_card() -> dict[str, Any]:
    """Report SHAP drivers, calibration, and per-band error for each horizon."""

    manifest_value = os.getenv("WBGT_MODEL_MANIFEST")
    expected_checksum = os.getenv("WBGT_MODEL_MANIFEST_SHA256")
    if not manifest_value or not expected_checksum:
        return _unconfigured_card()

    try:
        _, manifest = verified_manifest(Path(manifest_value), expected_checksum)
    except (ModelConfigurationError, OSError):
        return _unconfigured_card()

    return {
        "model_version": manifest.get("model_version") or BASELINE_MODEL_VERSION,
        "horizons": _horizon_cards(manifest.get("horizons")),
    }


def _unconfigured_card() -> dict[str, Any]:
    return {
        "model_version": BASELINE_MODEL_VERSION,
        "horizons": {},
    }


def _horizon_cards(horizon_payload: object) -> dict[str, dict[str, Any]]:
    if not isinstance(horizon_payload, Mapping):
        return {}
    result: dict[str, dict[str, Any]] = {}
    for horizon in ("30", "60"):
        configuration = horizon_payload.get(horizon)
        if not isinstance(configuration, Mapping):
            continue
        card = _horizon_card(configuration)
        if card is not None:
            result[horizon] = card
    return result


def _horizon_card(configuration: Mapping[str, Any]) -> dict[str, Any] | None:
    metrics = configuration.get("metrics")
    candidate_metrics = metrics.get("candidate") if isinstance(metrics, Mapping) else None
    mae_by_actual_band = (
        candidate_metrics.get("mae_by_actual_band")
        if isinstance(candidate_metrics, Mapping)
        else None
    )
    if not isinstance(mae_by_actual_band, Mapping):
        return None

    shap_drivers = configuration.get("shap_drivers")
    valid_drivers = (
        [driver for driver in shap_drivers if isinstance(driver, Mapping)]
        if isinstance(shap_drivers, list)
        else []
    )

    calibration = _calibration(configuration.get("prediction_interval"))

    return {
        "shap_drivers": valid_drivers,
        "shap_computed": bool(valid_drivers),
        "calibration": calibration,
        "mae_by_actual_band": mae_by_actual_band,
    }


def _calibration(prediction_interval: object) -> dict[str, Any] | None:
    if not isinstance(prediction_interval, Mapping):
        return None
    target_coverage = prediction_interval.get("target_coverage")
    final_test_coverage = prediction_interval.get("final_test_coverage")
    calibration_sample_count = prediction_interval.get("calibration_sample_count")
    if (
        not isinstance(target_coverage, (int, float))
        or not isinstance(final_test_coverage, (int, float))
        or not isinstance(calibration_sample_count, int)
    ):
        return None
    return {
        "target_coverage": float(target_coverage),
        "final_test_coverage": float(final_test_coverage),
        "calibration_sample_count": calibration_sample_count,
    }
