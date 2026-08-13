"""Rolling chronological evaluation for WBGT forecast candidates."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

from .estimators import apply_persistence_floor
from .evaluation import evaluate_predictions, meets_acceptance_rule
from .features import TARGET_BY_HORIZON, ChronologicalSplit
from .training import RANDOM_SEED, build_hist_gradient_pipeline


@dataclass(frozen=True)
class RollingWindow:
    """One expanding training window followed by validation and test periods."""

    number: int
    split: ChronologicalSplit
    test_end: pd.Timestamp


def expanding_rolling_windows(
    feature_frame: pd.DataFrame,
    *,
    horizon_minutes: int,
    minimum_training_days: int = 42,
    validation_days: int = 21,
    test_days: int = 21,
    evaluation_end: pd.Timestamp | None = None,
) -> tuple[RollingWindow, ...]:
    """Create non-overlapping test windows without crossing target boundaries."""

    if horizon_minutes not in TARGET_BY_HORIZON:
        raise ValueError("horizon_minutes must be 30 or 60")
    for name, value in (
        ("minimum_training_days", minimum_training_days),
        ("validation_days", validation_days),
        ("test_days", test_days),
    ):
        if value <= 0:
            raise ValueError(f"{name} must be positive")

    target = TARGET_BY_HORIZON[horizon_minutes]
    if "observed_at" not in feature_frame or target not in feature_frame:
        raise ValueError("feature frame is missing timestamps or the requested target")
    eligible = feature_frame.loc[feature_frame[target].notna()].copy()
    eligible["observed_at"] = pd.to_datetime(eligible["observed_at"], utc=True)
    if eligible.empty:
        raise ValueError("feature frame has no eligible forecast targets")

    available_start = eligible["observed_at"].min()
    available_end = eligible["observed_at"].max() + pd.Timedelta(minutes=15)
    end = _utc_timestamp(evaluation_end) if evaluation_end is not None else available_end
    end = min(end, available_end)
    validation_duration = pd.Timedelta(days=validation_days)
    test_duration = pd.Timedelta(days=test_days)
    purge = pd.Timedelta(minutes=horizon_minutes)
    validation_start = available_start + pd.Timedelta(days=minimum_training_days)
    test_start = validation_start + validation_duration

    windows: list[RollingWindow] = []
    while test_start + test_duration <= end:
        test_end = test_start + test_duration
        train = eligible.loc[
            eligible["observed_at"] < validation_start - purge
        ].copy()
        validation = eligible.loc[
            (eligible["observed_at"] >= validation_start)
            & (eligible["observed_at"] < test_start - purge)
        ].copy()
        test = eligible.loc[
            (eligible["observed_at"] >= test_start)
            & (eligible["observed_at"] < test_end)
        ].copy()
        if train.empty or validation.empty or test.empty:
            raise ValueError("rolling backtest produced an empty window")
        windows.append(
            RollingWindow(
                number=len(windows) + 1,
                split=ChronologicalSplit(
                    train=train,
                    validation=validation,
                    test=test,
                    train_boundary=validation_start,
                    test_boundary=test_start,
                    purge_minutes=horizon_minutes,
                ),
                test_end=test_end,
            )
        )
        test_start = test_end
        validation_start = test_start - validation_duration

    if not windows:
        raise ValueError("date range is too short for a complete rolling backtest window")
    return tuple(windows)


def run_rolling_backtest(
    feature_frame: pd.DataFrame,
    *,
    horizon_minutes: int,
    numeric_features: list[str],
    categorical_features: list[str],
    evaluation_end: pd.Timestamp | None = None,
    minimum_training_days: int = 42,
    validation_days: int = 21,
    test_days: int = 21,
) -> dict[str, Any]:
    """Compare persistence, raw boosting, and its safety-floor variant."""

    target = TARGET_BY_HORIZON[horizon_minutes]
    feature_columns = numeric_features + categorical_features
    windows = expanding_rolling_windows(
        feature_frame,
        horizon_minutes=horizon_minutes,
        minimum_training_days=minimum_training_days,
        validation_days=validation_days,
        test_days=test_days,
        evaluation_end=evaluation_end,
    )
    all_actual: list[np.ndarray] = []
    all_persistence: list[np.ndarray] = []
    all_candidate: list[np.ndarray] = []
    all_safety_floor: list[np.ndarray] = []
    fold_records: list[dict[str, Any]] = []

    for window in windows:
        split = window.split
        training_rows = pd.concat([split.train, split.validation], ignore_index=True)
        model = build_hist_gradient_pipeline(
            numeric_features,
            categorical_features,
            max_leaf_nodes=15,
        )
        model.fit(training_rows[feature_columns], training_rows[target])

        actual = split.test[target].to_numpy(dtype=float)
        persistence = split.test["wbgt_t"].to_numpy(dtype=float)
        candidate = np.asarray(model.predict(split.test[feature_columns]), dtype=float)
        safety_floor = apply_persistence_floor(candidate, persistence)
        persistence_metrics = evaluate_predictions(actual, persistence)
        candidate_metrics = evaluate_predictions(actual, candidate)
        safety_floor_metrics = evaluate_predictions(actual, safety_floor)

        all_actual.append(actual)
        all_persistence.append(persistence)
        all_candidate.append(candidate)
        all_safety_floor.append(safety_floor)
        fold_records.append(
            {
                "fold": window.number,
                "train_start": split.train["observed_at"].min().isoformat(),
                "train_end": split.train["observed_at"].max().isoformat(),
                "validation_start": split.validation["observed_at"].min().isoformat(),
                "validation_end": split.validation["observed_at"].max().isoformat(),
                "test_start": split.test["observed_at"].min().isoformat(),
                "test_end_exclusive": window.test_end.isoformat(),
                "rows": {
                    "train": len(split.train),
                    "validation": len(split.validation),
                    "test": len(split.test),
                    "test_at_least_32": int(np.sum(actual >= 32.0)),
                    "test_at_least_33": int(np.sum(actual >= 33.0)),
                },
                "models": {
                    "persistence": persistence_metrics.as_dict(),
                    "hist_gradient": candidate_metrics.as_dict(),
                    "hist_gradient_persistence_floor": safety_floor_metrics.as_dict(),
                },
                "safety_floor_passed": meets_acceptance_rule(
                    safety_floor_metrics,
                    persistence_metrics,
                ),
            }
        )

    actual = np.concatenate(all_actual)
    persistence = np.concatenate(all_persistence)
    candidate = np.concatenate(all_candidate)
    safety_floor = np.concatenate(all_safety_floor)
    persistence_metrics = evaluate_predictions(actual, persistence)
    candidate_metrics = evaluate_predictions(actual, candidate)
    safety_floor_metrics = evaluate_predictions(actual, safety_floor)
    passed_folds = sum(bool(fold["safety_floor_passed"]) for fold in fold_records)
    return {
        "schema_version": 1,
        "horizon_minutes": horizon_minutes,
        "random_seed": RANDOM_SEED,
        "method": {
            "training_window": "expanding",
            "minimum_training_days": minimum_training_days,
            "validation_days": validation_days,
            "test_days": test_days,
            "purge_minutes": horizon_minutes,
            "candidate": "HistGradientBoostingRegressor with 15 maximum leaves",
            "safety_floor": "maximum of trained prediction and current WBGT",
        },
        "fold_count": len(fold_records),
        "safety_floor_passed_folds": passed_folds,
        "safety_floor_passed_every_fold": passed_folds == len(fold_records),
        "folds": fold_records,
        "aggregate": {
            "persistence": persistence_metrics.as_dict(),
            "hist_gradient": candidate_metrics.as_dict(),
            "hist_gradient_persistence_floor": safety_floor_metrics.as_dict(),
            "safety_floor_passed": meets_acceptance_rule(
                safety_floor_metrics,
                persistence_metrics,
            ),
        },
    }


def _utc_timestamp(value: pd.Timestamp) -> pd.Timestamp:
    timestamp = pd.Timestamp(value)
    if timestamp.tzinfo is None:
        raise ValueError("evaluation_end must include a timezone")
    return timestamp.tz_convert("UTC")
