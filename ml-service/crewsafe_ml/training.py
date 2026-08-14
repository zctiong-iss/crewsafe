"""Reproducible training, comparison, selection, and artifact packaging."""

from __future__ import annotations

import os
import re
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from .estimators import PersistenceFloorRegressor
from .evaluation import ForecastMetrics, evaluate_predictions, meets_acceptance_rule
from .features import (
    FEATURE_VERSION,
    TARGET_BY_HORIZON,
    ChronologicalSplit,
    build_feature_frame,
    chronological_split,
    load_normalized_readings,
    model_feature_columns,
)
from .safe_paths import (
    confined_existing_file,
    confined_output_path,
    read_json_object,
    sha256_file,
    write_json_atomically,
)


RANDOM_SEED = 114
INTERVAL_COVERAGE = 0.95
SELECTION_RULE = (
    "A candidate must beat persistence test MAE without reducing recall at WBGT >=32 "
    "or >=33; validation MAE breaks ties between accepted candidates."
)


@dataclass(frozen=True)
class TrainedHorizon:
    horizon_minutes: int
    selected_model: str
    artifact_path: Path | None
    persistence_metrics: ForecastMetrics
    ridge_metrics: ForecastMetrics
    candidate_metrics: ForecastMetrics
    safety_floor_metrics: ForecastMetrics
    interval_half_width: float
    interval_calibration_sample_count: int
    test_interval_coverage: float
    training_seconds: float
    validation_trials: tuple[dict[str, Any], ...]


def train_and_package(
    *,
    dataset_path: Path,
    dataset_manifest_path: Path,
    output_directory: Path,
    workspace_root: Path,
    model_version: str | None = None,
    source_commit: str | None = None,
) -> Path:
    """Train both forecast horizons and return the checksum-pinned manifest path."""

    safe_dataset_path = confined_existing_file(
        dataset_path,
        workspace_root,
        label="training dataset",
    )
    safe_manifest_path = confined_existing_file(
        dataset_manifest_path,
        workspace_root,
        label="dataset manifest",
    )
    safe_output_directory = confined_output_path(
        output_directory,
        workspace_root,
        label="model output directory",
    )
    dataset_manifest = _read_dataset_manifest(
        safe_manifest_path,
        safe_dataset_path,
        workspace_root,
    )
    readings = load_normalized_readings(safe_dataset_path)
    feature_frame = build_feature_frame(readings)
    numeric_features, categorical_features = model_feature_columns(feature_frame)
    version = model_version or _default_model_version(dataset_manifest["normalized_sha256"])
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}", version):
        raise ValueError("model_version contains unsupported characters")
    destination = confined_output_path(
        safe_output_directory / version,
        workspace_root,
        label="versioned model output",
    )
    destination.mkdir(parents=True, exist_ok=False)

    trained_horizons = [
        _train_horizon(
            feature_frame,
            horizon_minutes=horizon,
            output_directory=destination,
            workspace_root=workspace_root,
            numeric_features=numeric_features,
            categorical_features=categorical_features,
        )
        for horizon in sorted(TARGET_BY_HORIZON)
    ]
    manifest = {
        "schema_version": 2,
        "model_version": version,
        "feature_version": FEATURE_VERSION,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source_commit": source_commit or _current_commit(),
        "dataset": {
            "start_date": dataset_manifest["start_date"],
            "end_date": dataset_manifest["end_date"],
            "sha256": dataset_manifest["normalized_sha256"],
        },
        "training": {
            "random_seed": RANDOM_SEED,
            "selection_rule": SELECTION_RULE,
        },
        "numeric_features": numeric_features,
        "categorical_features": categorical_features,
        "horizons": {
            str(result.horizon_minutes): _horizon_manifest(
                result,
                destination,
                workspace_root,
            )
            for result in trained_horizons
        },
    }
    manifest_path = destination / "manifest.json"
    write_json_atomically(
        manifest_path,
        manifest,
        workspace_root,
        label="model manifest",
    )
    return manifest_path


def _train_horizon(
    feature_frame: pd.DataFrame,
    *,
    horizon_minutes: int,
    output_directory: Path,
    workspace_root: Path,
    numeric_features: list[str],
    categorical_features: list[str],
) -> TrainedHorizon:
    horizon_started_at = time.perf_counter()
    split = chronological_split(feature_frame, horizon_minutes=horizon_minutes)
    target = TARGET_BY_HORIZON[horizon_minutes]
    feature_columns = numeric_features + categorical_features

    ridge_search = _run_validation_search(
        [
            _CandidateSpec(
                name=f"ridge-alpha-{alpha}",
                model=_ridge_pipeline(numeric_features, categorical_features, alpha),
                hyperparameters={"alpha": alpha},
                complexity="linear model",
            )
            for alpha in (0.1, 1.0, 10.0)
        ],
        split,
        feature_columns,
        target,
    )
    candidate_search = _run_validation_search(
        [
            _CandidateSpec(
                name="hist-gradient-leaves-15",
                model=build_hist_gradient_pipeline(
                    numeric_features,
                    categorical_features,
                    max_leaf_nodes=15,
                ),
                hyperparameters={
                    "max_leaf_nodes": 15,
                    "learning_rate": 0.08,
                    "l2_regularization": 0.1,
                    "random_state": RANDOM_SEED,
                },
                complexity="gradient-boosted decision trees with at most 15 leaves per tree",
            ),
            _CandidateSpec(
                name="hist-gradient-leaves-31",
                model=build_hist_gradient_pipeline(
                    numeric_features,
                    categorical_features,
                    max_leaf_nodes=31,
                ),
                hyperparameters={
                    "max_leaf_nodes": 31,
                    "learning_rate": 0.08,
                    "l2_regularization": 0.1,
                    "random_state": RANDOM_SEED,
                },
                complexity="gradient-boosted decision trees with at most 31 leaves per tree",
            ),
        ],
        split,
        feature_columns,
        target,
    )
    safety_floor_search = _run_validation_search(
        [
            _CandidateSpec(
                name=f"hist-gradient-leaves-{max_leaf_nodes}-persistence-floor",
                model=PersistenceFloorRegressor(
                    build_hist_gradient_pipeline(
                        numeric_features,
                        categorical_features,
                        max_leaf_nodes=max_leaf_nodes,
                    )
                ),
                hyperparameters={
                    "max_leaf_nodes": max_leaf_nodes,
                    "learning_rate": 0.08,
                    "l2_regularization": 0.1,
                    "random_state": RANDOM_SEED,
                    "minimum_prediction": "current WBGT",
                },
                complexity=(
                    "gradient-boosted decision trees whose prediction is never below "
                    "the current WBGT"
                ),
            )
            for max_leaf_nodes in (15, 31)
        ],
        split,
        feature_columns,
        target,
    )
    ridge = ridge_search.selected
    candidate = candidate_search.selected
    safety_floor = safety_floor_search.selected

    combined = pd.concat([split.train, split.validation], ignore_index=True)
    ridge.model.fit(combined[feature_columns], combined[target])
    candidate.model.fit(combined[feature_columns], combined[target])
    safety_floor.model.fit(combined[feature_columns], combined[target])
    actual = split.test[target].to_numpy()
    persistence_metrics = evaluate_predictions(actual, split.test["wbgt_t"].to_numpy())
    ridge_metrics = evaluate_predictions(actual, ridge.model.predict(split.test[feature_columns]))
    candidate_metrics = evaluate_predictions(
        actual,
        candidate.model.predict(split.test[feature_columns]),
    )
    safety_floor_metrics = evaluate_predictions(
        actual,
        safety_floor.model.predict(split.test[feature_columns]),
    )

    accepted_models = [
        (safety_floor, safety_floor_metrics),
        (candidate, candidate_metrics),
        (ridge, ridge_metrics),
    ]
    accepted_models = [
        (model, metrics)
        for model, metrics in accepted_models
        if meets_acceptance_rule(metrics, persistence_metrics)
    ]
    selected_name = "persistence"
    selected_model: Pipeline | None = None
    validation_actual = split.validation[target].to_numpy()
    interval_predictions = split.validation["wbgt_t"].to_numpy()
    selected_test_predictions = split.test["wbgt_t"].to_numpy()
    if accepted_models:
        # The final test window is only an acceptance gate. Among models that
        # pass it, choose using validation MAE to avoid tuning on test results.
        selected, _ = min(
            accepted_models,
            key=lambda accepted: accepted[0].validation_mae,
        )
        selected_name = selected.name
        selected_model = selected.model
        interval_predictions = selected.validation_predictions
        selected_test_predictions = selected.model.predict(split.test[feature_columns])

    interval_half_width = _calibrate_interval(validation_actual, interval_predictions)
    test_interval_coverage = float(
        np.mean(np.abs(actual - selected_test_predictions) <= interval_half_width)
    )

    artifact_path = None
    if selected_model is not None:
        artifact_path = confined_output_path(
            output_directory / f"forecast-{horizon_minutes}m.joblib",
            workspace_root,
            label="model artifact",
        )
        joblib.dump(selected_model, artifact_path, compress=3)

    validation_trials = (
        _persistence_validation_trial(split, target),
        *ridge_search.trial_records,
        *candidate_search.trial_records,
        *safety_floor_search.trial_records,
    )
    training_seconds = time.perf_counter() - horizon_started_at
    split_metadata = {
        "train_boundary": split.train_boundary.isoformat(),
        "test_boundary": split.test_boundary.isoformat(),
        "purge_minutes": split.purge_minutes,
        "train_rows": len(split.train),
        "validation_rows": len(split.validation),
        "test_rows": len(split.test),
    }
    write_json_atomically(
        output_directory / f"evaluation-{horizon_minutes}m.json",
        {
            "horizon_minutes": horizon_minutes,
            "selected_model": selected_name,
            "split": split_metadata,
            "experiment": {
                "random_seed": RANDOM_SEED,
                "selection_rule": SELECTION_RULE,
                "training_seconds": training_seconds,
                "validation_trials": list(validation_trials),
            },
            "prediction_interval": {
                "method": "absolute validation residual quantile",
                "target_coverage": INTERVAL_COVERAGE,
                "calibration_window": "validation",
                "calibration_sample_count": len(validation_actual),
                "half_width": interval_half_width,
                "final_test_coverage": test_interval_coverage,
            },
            "models": {
                "persistence": persistence_metrics.as_dict(),
                ridge.name: ridge_metrics.as_dict(),
                candidate.name: candidate_metrics.as_dict(),
                safety_floor.name: safety_floor_metrics.as_dict(),
            },
        },
        workspace_root,
        label="model evaluation report",
    )
    return TrainedHorizon(
        horizon_minutes=horizon_minutes,
        selected_model=selected_name,
        artifact_path=artifact_path,
        persistence_metrics=persistence_metrics,
        ridge_metrics=ridge_metrics,
        candidate_metrics=candidate_metrics,
        safety_floor_metrics=safety_floor_metrics,
        interval_half_width=interval_half_width,
        interval_calibration_sample_count=len(validation_actual),
        test_interval_coverage=test_interval_coverage,
        training_seconds=training_seconds,
        validation_trials=validation_trials,
    )


@dataclass(frozen=True)
class _ValidationModel:
    name: str
    model: Pipeline
    validation_metrics: ForecastMetrics
    validation_predictions: np.ndarray

    @property
    def validation_mae(self) -> float:
        return self.validation_metrics.mae


@dataclass(frozen=True)
class _CandidateSpec:
    name: str
    model: Pipeline
    hyperparameters: dict[str, Any]
    complexity: str


@dataclass(frozen=True)
class _ValidationSearch:
    selected: _ValidationModel
    trial_records: tuple[dict[str, Any], ...]


def _run_validation_search(
    candidates: list[_CandidateSpec],
    split: ChronologicalSplit,
    feature_columns: list[str],
    target: str,
) -> _ValidationSearch:
    evaluated: list[_ValidationModel] = []
    trial_records: list[dict[str, Any]] = []
    for candidate in candidates:
        fit_started_at = time.perf_counter()
        candidate.model.fit(split.train[feature_columns], split.train[target])
        fit_seconds = time.perf_counter() - fit_started_at
        prediction_started_at = time.perf_counter()
        predictions = candidate.model.predict(split.validation[feature_columns])
        prediction_seconds = time.perf_counter() - prediction_started_at
        metrics = evaluate_predictions(
            split.validation[target].to_numpy(),
            predictions,
        )
        evaluated.append(
            _ValidationModel(
                candidate.name,
                candidate.model,
                metrics,
                np.asarray(predictions, dtype=float),
            )
        )
        trial_records.append(
            {
                "name": candidate.name,
                "hyperparameters": candidate.hyperparameters,
                "complexity": candidate.complexity,
                "fit_seconds": fit_seconds,
                "validation_prediction_seconds": prediction_seconds,
                "validation_metrics": metrics.as_dict(),
            }
        )
    return _ValidationSearch(
        selected=min(evaluated, key=lambda result: result.validation_mae),
        trial_records=tuple(trial_records),
    )


def _persistence_validation_trial(
    split: ChronologicalSplit,
    target: str,
) -> dict[str, Any]:
    metrics = evaluate_predictions(
        split.validation[target].to_numpy(),
        split.validation["wbgt_t"].to_numpy(),
    )
    return {
        "name": "persistence",
        "hyperparameters": {},
        "complexity": "no fitted parameters; predicts that WBGT stays unchanged",
        "fit_seconds": 0.0,
        "validation_prediction_seconds": 0.0,
        "validation_metrics": metrics.as_dict(),
    }


def _calibrate_interval(actual: np.ndarray, predicted: np.ndarray) -> float:
    """Create the interval from validation residuals, never final-test residuals."""

    actual = np.asarray(actual, dtype=float)
    predicted = np.asarray(predicted, dtype=float)
    if actual.shape != predicted.shape or actual.ndim != 1 or actual.size == 0:
        raise ValueError("interval inputs must be non-empty one-dimensional arrays")
    if not np.isfinite(actual).all() or not np.isfinite(predicted).all():
        raise ValueError("interval inputs must contain only finite values")
    return float(np.quantile(np.abs(actual - predicted), INTERVAL_COVERAGE))


def _preprocessor(
    numeric_features: list[str],
    categorical_features: list[str],
    *,
    scale_numeric: bool,
) -> ColumnTransformer:
    numeric_steps: list[tuple[str, Any]] = [
        ("impute", SimpleImputer(strategy="median", add_indicator=True))
    ]
    if scale_numeric:
        numeric_steps.append(("scale", StandardScaler()))
    return ColumnTransformer(
        [
            ("numeric", Pipeline(numeric_steps), numeric_features),
            (
                "categorical",
                OneHotEncoder(handle_unknown="ignore", sparse_output=False),
                categorical_features,
            ),
        ],
        verbose_feature_names_out=False,
    )


def _ridge_pipeline(
    numeric_features: list[str],
    categorical_features: list[str],
    alpha: float,
) -> Pipeline:
    return Pipeline(
        [
            (
                "preprocess",
                _preprocessor(numeric_features, categorical_features, scale_numeric=True),
            ),
            ("model", Ridge(alpha=alpha)),
        ]
    )


def build_hist_gradient_pipeline(
    numeric_features: list[str],
    categorical_features: list[str],
    *,
    max_leaf_nodes: int,
) -> Pipeline:
    """Build the project's reproducible nonlinear WBGT candidate."""

    return Pipeline(
        [
            (
                "preprocess",
                _preprocessor(numeric_features, categorical_features, scale_numeric=False),
            ),
            (
                "model",
                HistGradientBoostingRegressor(
                    max_leaf_nodes=max_leaf_nodes,
                    learning_rate=0.08,
                    l2_regularization=0.1,
                    random_state=RANDOM_SEED,
                ),
            ),
        ]
    )


def _read_dataset_manifest(
    path: Path,
    dataset_path: Path,
    workspace_root: Path,
) -> dict[str, Any]:
    payload = dict(
        read_json_object(
            path,
            workspace_root,
            label="dataset manifest",
        )
    )
    expected_hash = payload.get("normalized_sha256")
    if not isinstance(expected_hash, str) or expected_hash != sha256_file(
        dataset_path,
        workspace_root,
        label="training dataset",
    ):
        raise ValueError("dataset checksum does not match its manifest")
    for field in ("start_date", "end_date"):
        if not isinstance(payload.get(field), str):
            raise ValueError(f"dataset manifest is missing {field}")
    return payload


def _horizon_manifest(
    result: TrainedHorizon,
    destination: Path,
    workspace_root: Path,
) -> dict[str, Any]:
    artifact_name = result.artifact_path.name if result.artifact_path else None
    return {
        "selected_model": result.selected_model,
        "artifact": artifact_name,
        "artifact_sha256": (
            sha256_file(
                destination / artifact_name,
                workspace_root,
                label="model artifact",
            )
            if artifact_name
            else None
        ),
        "interval_half_width": result.interval_half_width,
        "prediction_interval": {
            "method": "absolute validation residual quantile",
            "target_coverage": INTERVAL_COVERAGE,
            "calibration_window": "validation",
            "calibration_sample_count": result.interval_calibration_sample_count,
            "final_test_coverage": result.test_interval_coverage,
        },
        "training_seconds": result.training_seconds,
        "validation_trials": list(result.validation_trials),
        "metrics": {
            "persistence": result.persistence_metrics.as_dict(),
            "ridge": result.ridge_metrics.as_dict(),
            "candidate": result.candidate_metrics.as_dict(),
            "safety_floor": result.safety_floor_metrics.as_dict(),
        },
    }


def _default_model_version(dataset_hash: str) -> str:
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"wbgt-{today}-{dataset_hash[:8]}"


def _current_commit() -> str:
    configured_commit = os.getenv("GITHUB_SHA")
    if configured_commit:
        return configured_commit
    revision = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
        timeout=5,
    ).stdout.strip()
    tracked_changes = subprocess.run(
        ["git", "status", "--porcelain", "--untracked-files=no"],
        check=True,
        capture_output=True,
        text=True,
        timeout=5,
    ).stdout.strip()
    return f"{revision}-dirty" if tracked_changes else revision
