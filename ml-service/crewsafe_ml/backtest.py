"""CLI for reproducible rolling WBGT model backtests."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

import pandas as pd

from .backtesting import run_rolling_backtest
from .features import FEATURE_VERSION, model_feature_columns


def main(arguments: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run rolling WBGT forecast backtests.")
    parser.add_argument("--features", required=True, type=Path)
    parser.add_argument("--feature-manifest", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--evaluation-end", required=True)
    options = parser.parse_args(arguments)

    if options.output.exists():
        raise ValueError("backtest output already exists")
    dataset_manifest = _verified_feature_manifest(
        options.feature_manifest,
        options.features,
    )
    feature_frame = pd.read_csv(options.features, parse_dates=["observed_at"])
    feature_frame["observed_at"] = pd.to_datetime(
        feature_frame["observed_at"],
        utc=True,
        errors="raise",
    )
    numeric_features, categorical_features = model_feature_columns(feature_frame)
    evaluation_end = pd.Timestamp(options.evaluation_end)
    reports = {
        str(horizon): run_rolling_backtest(
            feature_frame,
            horizon_minutes=horizon,
            numeric_features=numeric_features,
            categorical_features=categorical_features,
            evaluation_end=evaluation_end,
        )
        for horizon in (30, 60)
    }
    payload = {
        "schema_version": 1,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "feature_version": FEATURE_VERSION,
        "dataset": {
            "start_date": dataset_manifest["start_date"],
            "end_date": dataset_manifest["end_date"],
            "feature_sha256": dataset_manifest["prepared_15_minute_dataset"]["sha256"],
        },
        "evaluation_end_exclusive": evaluation_end.isoformat(),
        "note": (
            "These historical folds support model development but are not a new untouched "
            "approval period."
        ),
        "horizons": reports,
    }
    options.output.parent.mkdir(parents=True, exist_ok=True)
    _write_json_atomically(options.output, payload)
    print(f"Rolling backtest: {options.output}")
    for horizon, report in reports.items():
        aggregate = report["aggregate"]
        print(
            f"{horizon}m: safety floor passed "
            f"{report['safety_floor_passed_folds']}/{report['fold_count']} folds; "
            f"aggregate MAE "
            f"{aggregate['persistence']['mae']:.4f} -> "
            f"{aggregate['hist_gradient_persistence_floor']['mae']:.4f}"
        )
    return 0


def _verified_feature_manifest(path: Path, feature_path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    prepared = payload.get("prepared_15_minute_dataset")
    if not isinstance(prepared, dict):
        raise ValueError("feature manifest is missing prepared dataset details")
    if prepared.get("sha256") != _sha256(feature_path):
        raise ValueError("feature dataset checksum does not match its manifest")
    # Downloader manifests keep this beside the prepared dataset. Combined
    # manifests may declare it at the top level, so support both documented
    # shapes while still rejecting unknown feature definitions.
    declared_feature_version = prepared.get("feature_version") or payload.get(
        "feature_version"
    )
    if declared_feature_version != FEATURE_VERSION:
        raise ValueError("feature dataset version does not match this code")
    for field in ("start_date", "end_date"):
        if not isinstance(payload.get(field), str):
            raise ValueError(f"feature manifest is missing {field}")
    return payload


def _write_json_atomically(path: Path, payload: dict[str, Any]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(64 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
