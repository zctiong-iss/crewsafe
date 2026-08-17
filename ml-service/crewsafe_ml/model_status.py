"""Read-only reporting of the configured WBGT model's approval status and metrics.

Reads the same checksum-pinned manifest ForecastModelRegistry trusts for inference,
but never loads the joblib artifacts: this is a low-traffic dashboard read, not the
inference hot path.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Mapping

from .inference import ModelConfigurationError, verified_manifest

NO_MODEL_CONFIGURED = "no model configured"
BASELINE_MODEL_VERSION = "baseline-1.0.0"


def current_model_status() -> dict[str, Any]:
    """Report the configured model bundle's approval status and evaluation metrics."""

    manifest_value = os.getenv("WBGT_MODEL_MANIFEST")
    expected_checksum = os.getenv("WBGT_MODEL_MANIFEST_SHA256")
    if not manifest_value or not expected_checksum:
        return _unconfigured_status()

    try:
        _, manifest = verified_manifest(Path(manifest_value), expected_checksum)
    except (ModelConfigurationError, OSError):
        return _unconfigured_status()

    return {
        "model_version": manifest.get("model_version") or BASELINE_MODEL_VERSION,
        "approved_for_inference": manifest.get("approved_for_inference") is True,
        "approval_blocker": manifest.get("approval_blocker"),
        "horizons": _horizon_metrics(manifest.get("horizons")),
    }


def _unconfigured_status() -> dict[str, Any]:
    return {
        "model_version": BASELINE_MODEL_VERSION,
        "approved_for_inference": False,
        "approval_blocker": NO_MODEL_CONFIGURED,
        "horizons": {},
    }


def _horizon_metrics(horizon_payload: object) -> dict[str, Mapping[str, Any]]:
    if not isinstance(horizon_payload, Mapping):
        return {}
    result: dict[str, Mapping[str, Any]] = {}
    for horizon in ("30", "60"):
        configuration = horizon_payload.get(horizon)
        if not isinstance(configuration, Mapping):
            continue
        metrics = configuration.get("metrics")
        if not isinstance(metrics, Mapping):
            continue
        candidate = metrics.get("candidate")
        if isinstance(candidate, Mapping):
            result[horizon] = candidate
    return result
