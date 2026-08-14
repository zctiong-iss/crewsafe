"""Evaluate one frozen WBGT model bundle on a newer untouched dataset.

This module produces review evidence only. It deliberately cannot modify or
approve a model manifest; promotion remains a separate human-reviewed action.
"""

from __future__ import annotations

import math
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

import joblib
import numpy as np
import pandas as pd

from .evaluation import evaluate_predictions, meets_acceptance_rule
from .features import FEATURE_VERSION, TARGET_BY_HORIZON
from .safe_paths import confined_existing_file, read_json_object, sha256_file


DEFAULT_MINIMUM_UNTOUCHED_DAYS = 21
MODEL_MANIFEST_SCHEMA_VERSION = 2


class ApprovalEvaluationError(ValueError):
    """The supplied model or evaluation dataset cannot be trusted or evaluated."""


def evaluate_frozen_candidate(
    *,
    model_manifest_path: Path,
    expected_model_manifest_sha256: str,
    feature_path: Path,
    feature_manifest_path: Path,
    workspace_root: Path,
    minimum_untouched_days: int = DEFAULT_MINIMUM_UNTOUCHED_DAYS,
) -> dict[str, Any]:
    """Return an approval report without changing the candidate model bundle."""

    if minimum_untouched_days < 1:
        raise ApprovalEvaluationError("minimum_untouched_days must be positive")

    model_manifest_file = confined_existing_file(
        model_manifest_path,
        workspace_root,
        label="model manifest",
    )
    feature_file = confined_existing_file(
        feature_path,
        workspace_root,
        label="untouched feature dataset",
    )
    feature_manifest_file = confined_existing_file(
        feature_manifest_path,
        workspace_root,
        label="untouched dataset manifest",
    )
    model_manifest_checksum = _verify_expected_checksum(
        model_manifest_file,
        expected_model_manifest_sha256,
        workspace_root,
    )
    model_manifest = dict(
        read_json_object(
            model_manifest_file,
            workspace_root,
            label="model manifest",
        )
    )
    feature_manifest = dict(
        read_json_object(
            feature_manifest_file,
            workspace_root,
            label="untouched dataset manifest",
        )
    )
    _validate_model_manifest(model_manifest)
    prepared_dataset = _validate_feature_manifest(
        feature_manifest,
        feature_file,
        workspace_root,
    )

    features = pd.read_csv(feature_file, parse_dates=["observed_at"])
    features["observed_at"] = pd.to_datetime(
        features["observed_at"],
        utc=True,
        errors="raise",
    )
    _validate_feature_columns(features, model_manifest)
    if prepared_dataset["row_count"] != len(features):
        raise ApprovalEvaluationError("untouched feature row count does not match its manifest")

    training_end = _manifest_date(model_manifest, "dataset", "end_date")
    candidate_created_at = _manifest_timestamp(model_manifest, "created_at")
    candidate_frozen_date = candidate_created_at.tz_convert("UTC").tz_localize(None).normalize()
    evaluation_start = _top_level_date(feature_manifest, "start_date")
    evaluation_end = _top_level_date(feature_manifest, "end_date")
    inclusive_day_count = (evaluation_end - evaluation_start).days + 1
    period_after_training_passed = evaluation_start > training_end
    period_after_freeze_passed = evaluation_start > candidate_frozen_date
    complete_period_passed = evaluation_end < pd.Timestamp.now(tz="UTC").tz_localize(None).normalize()
    feature_version_passed = prepared_dataset["feature_version"] == FEATURE_VERSION
    source_commit = str(model_manifest.get("source_commit", ""))
    source_commit_passed = bool(re.fullmatch(r"[0-9a-fA-F]{40}", source_commit))
    duration_passed = inclusive_day_count >= minimum_untouched_days

    numeric_features = _string_list(model_manifest, "numeric_features")
    categorical_features = _string_list(model_manifest, "categorical_features")
    feature_columns = numeric_features + categorical_features
    horizon_reports: dict[str, Any] = {}
    horizon_gates: list[bool] = []
    risk_evidence_gates: list[bool] = []
    for horizon_minutes, target_column in TARGET_BY_HORIZON.items():
        eligible = features.loc[features[target_column].notna()].copy()
        if eligible.empty:
            raise ApprovalEvaluationError(
                f"untouched dataset has no eligible {horizon_minutes}-minute targets"
            )
        actual = eligible[target_column].to_numpy(dtype=float)
        persistence_predictions = eligible["wbgt_t"].to_numpy(dtype=float)
        candidate_predictions = _candidate_predictions(
            model_manifest,
            model_manifest_file.parent,
            horizon_minutes,
            eligible[feature_columns],
            workspace_root,
        )
        persistence_metrics = evaluate_predictions(actual, persistence_predictions)
        candidate_metrics = evaluate_predictions(actual, candidate_predictions)
        safety_rule_passed = meets_acceptance_rule(
            candidate_metrics,
            persistence_metrics,
        )
        actual_at_least_32 = int(np.count_nonzero(actual >= 32.0))
        actual_at_least_33 = int(np.count_nonzero(actual >= 33.0))
        has_high_risk_evidence = actual_at_least_32 > 0 and actual_at_least_33 > 0
        interval_half_width = _interval_half_width(model_manifest, horizon_minutes)
        interval_coverage = float(
            np.mean(np.abs(actual - candidate_predictions) <= interval_half_width)
        )
        horizon_reports[str(horizon_minutes)] = {
            "candidate": candidate_metrics.as_dict(),
            "persistence": persistence_metrics.as_dict(),
            "candidate_minus_persistence": {
                "mae": candidate_metrics.mae - persistence_metrics.mae,
                "recall_at_least_32": (
                    candidate_metrics.recall_at_least_32
                    - persistence_metrics.recall_at_least_32
                ),
                "recall_at_least_33": (
                    candidate_metrics.recall_at_least_33
                    - persistence_metrics.recall_at_least_33
                ),
            },
            "high_risk_actual_counts": {
                "at_least_32": actual_at_least_32,
                "at_least_33": actual_at_least_33,
            },
            "fixed_interval": {
                "half_width": interval_half_width,
                "coverage": interval_coverage,
            },
            "has_high_risk_evidence": has_high_risk_evidence,
            "passes_safety_rule": safety_rule_passed,
        }
        horizon_gates.append(safety_rule_passed)
        risk_evidence_gates.append(has_high_risk_evidence)

    gates = {
        "period_starts_after_training_data": period_after_training_passed,
        "period_starts_after_candidate_was_frozen": period_after_freeze_passed,
        "period_contains_only_complete_days": complete_period_passed,
        "feature_version_matches_frozen_model": feature_version_passed,
        "source_commit_is_reviewable": source_commit_passed,
        "minimum_untouched_period_days_met": duration_passed,
        "both_horizons_have_high_risk_examples": all(risk_evidence_gates),
        "both_horizons_beat_persistence_without_recall_loss": all(horizon_gates),
    }
    approved_by_automated_checks = all(gates.values())
    return {
        "schema_version": 1,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "decision": "READY_FOR_HUMAN_REVIEW" if approved_by_automated_checks else "BLOCKED",
        "automated_checks_passed": approved_by_automated_checks,
        "note": (
            "This report never approves or changes a model manifest. A human review and "
            "a separately checksum-pinned promotion are still required."
        ),
        "model": {
            "model_version": model_manifest["model_version"],
            "manifest_sha256": model_manifest_checksum,
            "source_commit": source_commit,
            "candidate_created_at": candidate_created_at.isoformat(),
            "training_end_date": training_end.isoformat(),
        },
        "untouched_dataset": {
            "start_date": evaluation_start.isoformat(),
            "end_date": evaluation_end.isoformat(),
            "inclusive_day_count": inclusive_day_count,
            "minimum_required_days": minimum_untouched_days,
            "feature_sha256": prepared_dataset["sha256"],
            "feature_row_count": int(prepared_dataset["row_count"]),
        },
        "gates": gates,
        "horizons": horizon_reports,
    }


def _verify_expected_checksum(
    manifest_path: Path,
    expected_checksum: str,
    workspace_root: Path,
) -> str:
    if not re.fullmatch(r"[0-9a-fA-F]{64}", expected_checksum):
        raise ApprovalEvaluationError("expected model manifest SHA-256 is invalid")
    actual_checksum = sha256_file(
        manifest_path,
        workspace_root,
        label="model manifest",
    )
    if actual_checksum != expected_checksum.lower():
        raise ApprovalEvaluationError("model manifest checksum does not match")
    return actual_checksum


def _validate_model_manifest(manifest: Mapping[str, Any]) -> None:
    if manifest.get("schema_version") != MODEL_MANIFEST_SCHEMA_VERSION:
        raise ApprovalEvaluationError("model manifest schema is unsupported")
    if manifest.get("feature_version") != FEATURE_VERSION:
        raise ApprovalEvaluationError("model feature version is unsupported")
    if not isinstance(manifest.get("model_version"), str) or not manifest["model_version"]:
        raise ApprovalEvaluationError("model manifest is missing model_version")
    horizons = manifest.get("horizons")
    if not isinstance(horizons, Mapping):
        raise ApprovalEvaluationError("model manifest is missing horizons")


def _validate_feature_manifest(
    manifest: Mapping[str, Any],
    feature_path: Path,
    workspace_root: Path,
) -> Mapping[str, Any]:
    prepared = manifest.get("prepared_15_minute_dataset")
    if not isinstance(prepared, Mapping):
        raise ApprovalEvaluationError(
            "untouched dataset manifest is missing prepared 15-minute details"
        )
    expected_checksum = prepared.get("sha256")
    if not isinstance(expected_checksum, str) or expected_checksum != sha256_file(
        feature_path,
        workspace_root,
        label="untouched feature dataset",
    ):
        raise ApprovalEvaluationError("untouched feature dataset checksum does not match")
    if prepared.get("feature_version") != FEATURE_VERSION:
        raise ApprovalEvaluationError("untouched feature version is incompatible")
    if prepared.get("file") != feature_path.name:
        raise ApprovalEvaluationError("untouched feature filename does not match its manifest")
    if not isinstance(prepared.get("row_count"), int) or prepared["row_count"] < 1:
        raise ApprovalEvaluationError("untouched feature row count is invalid")
    return prepared


def _validate_feature_columns(
    features: pd.DataFrame,
    model_manifest: Mapping[str, Any],
) -> None:
    required = {
        "observed_at",
        "wbgt_t",
        *_string_list(model_manifest, "numeric_features"),
        *_string_list(model_manifest, "categorical_features"),
        *TARGET_BY_HORIZON.values(),
    }
    missing = sorted(required.difference(features.columns))
    if missing:
        raise ApprovalEvaluationError(
            "untouched feature dataset is missing columns: " + ", ".join(missing)
        )


def _candidate_predictions(
    model_manifest: Mapping[str, Any],
    bundle_directory: Path,
    horizon_minutes: int,
    features: pd.DataFrame,
    workspace_root: Path,
) -> np.ndarray:
    horizons = model_manifest["horizons"]
    configuration = horizons.get(str(horizon_minutes))
    if not isinstance(configuration, Mapping):
        raise ApprovalEvaluationError(
            f"model manifest is missing horizon {horizon_minutes}"
        )
    selected_model = configuration.get("selected_model")
    if not isinstance(selected_model, str) or not selected_model:
        raise ApprovalEvaluationError("model manifest selected_model is invalid")
    if selected_model == "persistence":
        predictions = features["wbgt_t"].to_numpy(dtype=float)
    else:
        artifact_name = configuration.get("artifact")
        if not isinstance(artifact_name, str) or Path(artifact_name).name != artifact_name:
            raise ApprovalEvaluationError("model artifact name is invalid")
        artifact_path = confined_existing_file(
            bundle_directory / artifact_name,
            workspace_root,
            label=f"{horizon_minutes}-minute model artifact",
        )
        if artifact_path.parent != bundle_directory:
            raise ApprovalEvaluationError("model artifact escaped its bundle directory")
        expected_checksum = configuration.get("artifact_sha256")
        if not isinstance(expected_checksum, str) or expected_checksum != sha256_file(
            artifact_path,
            workspace_root,
            label=f"{horizon_minutes}-minute model artifact",
        ):
            raise ApprovalEvaluationError("model artifact checksum does not match")
        try:
            model = joblib.load(artifact_path)
            predictions = np.asarray(model.predict(features), dtype=float)
        except Exception as error:
            raise ApprovalEvaluationError("model artifact evaluation failed") from error
    if predictions.shape != (len(features),) or not np.isfinite(predictions).all():
        raise ApprovalEvaluationError("model produced invalid evaluation predictions")
    if np.any((predictions < 0) | (predictions > 60)):
        raise ApprovalEvaluationError("model produced out-of-range WBGT predictions")
    return predictions


def _interval_half_width(manifest: Mapping[str, Any], horizon_minutes: int) -> float:
    configuration = manifest["horizons"][str(horizon_minutes)]
    value = configuration.get("interval_half_width")
    if not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise ApprovalEvaluationError("model interval is missing or invalid")
    return float(value)


def _string_list(manifest: Mapping[str, Any], key: str) -> list[str]:
    value = manifest.get(key)
    if (
        not isinstance(value, list)
        or not value
        or not all(isinstance(item, str) and item for item in value)
    ):
        raise ApprovalEvaluationError(f"model manifest {key} is invalid")
    return list(value)


def _manifest_date(manifest: Mapping[str, Any], section: str, key: str) -> pd.Timestamp:
    payload = manifest.get(section)
    if not isinstance(payload, Mapping):
        raise ApprovalEvaluationError(f"model manifest is missing {section}")
    return _parse_date(payload.get(key), f"model {section}.{key}")


def _manifest_timestamp(manifest: Mapping[str, Any], key: str) -> pd.Timestamp:
    value = manifest.get(key)
    if not isinstance(value, str):
        raise ApprovalEvaluationError(f"model manifest {key} is missing")
    try:
        timestamp = pd.Timestamp(value)
    except ValueError as error:
        raise ApprovalEvaluationError(f"model manifest {key} is invalid") from error
    if timestamp.tzinfo is None:
        raise ApprovalEvaluationError(f"model manifest {key} must include a timezone")
    return timestamp


def _top_level_date(manifest: Mapping[str, Any], key: str) -> pd.Timestamp:
    return _parse_date(manifest.get(key), f"untouched dataset {key}")


def _parse_date(value: object, label: str) -> pd.Timestamp:
    if not isinstance(value, str):
        raise ApprovalEvaluationError(f"{label} is missing")
    try:
        timestamp = pd.Timestamp(value)
    except ValueError as error:
        raise ApprovalEvaluationError(f"{label} is invalid") from error
    if timestamp.time() != datetime.min.time() or timestamp.tzinfo is not None:
        raise ApprovalEvaluationError(f"{label} must be a YYYY-MM-DD date")
    return timestamp
