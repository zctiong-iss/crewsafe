"""Create a reproducible 15-minute table for training and inspection."""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from .features import FEATURE_VERSION, build_feature_frame, load_normalized_readings


@dataclass(frozen=True)
class PreparedDatasetResult:
    """Description of the generated 15-minute feature table."""

    path: Path
    sha256: str
    row_count: int
    column_count: int
    columns: tuple[str, ...]
    first_observed_at: str
    last_observed_at: str


def write_prepared_15_minute_dataset(
    normalized_dataset: Path,
    destination: Path,
) -> PreparedDatasetResult:
    """Build and atomically save the same 15-minute features used for training."""

    readings = load_normalized_readings(normalized_dataset)
    feature_frame = build_feature_frame(readings)
    if feature_frame.empty:
        raise ValueError("15-minute feature dataset cannot be empty")

    _write_frame_atomically(feature_frame, destination)
    timestamps = pd.to_datetime(feature_frame["observed_at"], utc=True)
    return PreparedDatasetResult(
        path=destination,
        sha256=_sha256(destination),
        row_count=len(feature_frame),
        column_count=len(feature_frame.columns),
        columns=tuple(feature_frame.columns),
        first_observed_at=timestamps.min().isoformat(),
        last_observed_at=timestamps.max().isoformat(),
    )


def prepared_dataset_manifest(result: PreparedDatasetResult) -> dict[str, object]:
    """Return the stable manifest section for a prepared feature table."""

    return {
        "file": result.path.name,
        "sha256": result.sha256,
        "feature_version": FEATURE_VERSION,
        "sample_interval_minutes": 15,
        "row_count": result.row_count,
        "column_count": result.column_count,
        "columns": list(result.columns),
        "first_observed_at": result.first_observed_at,
        "last_observed_at": result.last_observed_at,
    }


def _write_frame_atomically(frame: pd.DataFrame, destination: Path) -> None:
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    frame.to_csv(temporary, index=False)
    os.replace(temporary, destination)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(64 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
