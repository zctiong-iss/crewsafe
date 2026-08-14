"""Leakage-safe feature engineering for short-horizon WBGT forecasting."""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd


FEATURE_VERSION = "wbgt-features-1.2.0"
SAMPLE_INTERVAL = pd.Timedelta(minutes=15)
SUPPORT_READING_MAX_AGE = pd.Timedelta(minutes=8)
SUPPORTING_METRICS = (
    "air_temperature",
    "relative_humidity",
    "wind_speed",
    "wind_direction",
    "rainfall",
)
TARGET_BY_HORIZON = {30: "target_wbgt_30m", 60: "target_wbgt_60m"}


class FeaturePipelineError(ValueError):
    """The input dataset cannot safely produce training features."""


@dataclass(frozen=True)
class ChronologicalSplit:
    """Chronological frames with a purge gap between adjacent windows."""

    train: pd.DataFrame
    validation: pd.DataFrame
    test: pd.DataFrame
    train_boundary: pd.Timestamp
    test_boundary: pd.Timestamp
    purge_minutes: int


def load_normalized_readings(path: Path) -> pd.DataFrame:
    """Load and validate the normalized long-form historical dataset."""

    frame = pd.read_csv(path)
    required_columns = {
        "metric",
        "observed_at",
        "station_id",
        "latitude",
        "longitude",
        "value",
    }
    missing_columns = sorted(required_columns.difference(frame.columns))
    if missing_columns:
        raise FeaturePipelineError(
            "normalized dataset is missing columns: " + ", ".join(missing_columns)
        )

    frame = frame.copy()
    frame["observed_at"] = pd.to_datetime(frame["observed_at"], utc=True, errors="coerce")
    for column in ("latitude", "longitude", "value"):
        frame[column] = pd.to_numeric(frame[column], errors="coerce")

    invalid_rows = frame[
        frame[["observed_at", "station_id", "metric", "latitude", "longitude", "value"]]
        .isna()
        .any(axis=1)
    ]
    if not invalid_rows.empty:
        raise FeaturePipelineError(
            f"normalized dataset contains {len(invalid_rows)} incomplete or invalid rows"
        )
    if frame.duplicated(["metric", "observed_at", "station_id"]).any():
        raise FeaturePipelineError("normalized dataset contains duplicate observation keys")

    frame["metric"] = frame["metric"].astype(str)
    frame["station_id"] = frame["station_id"].astype(str)
    return frame.sort_values(["observed_at", "metric", "station_id"]).reset_index(drop=True)


def build_feature_frame(readings: pd.DataFrame) -> pd.DataFrame:
    """Create one 15-minute feature row per available WBGT station reading."""

    wbgt_readings = readings.loc[readings["metric"] == "wbgt"].copy()
    if wbgt_readings.empty:
        raise FeaturePipelineError("dataset does not contain WBGT readings")

    station_frames = [
        _build_station_features(readings, station_id, station_rows)
        for station_id, station_rows in wbgt_readings.groupby("station_id", sort=True)
    ]
    result = pd.concat(station_frames, ignore_index=True)
    result = result.loc[result["wbgt_t"].notna()].copy()
    return result.sort_values(["observed_at", "station_id"]).reset_index(drop=True)


def chronological_split(
    feature_frame: pd.DataFrame,
    *,
    horizon_minutes: int,
    train_fraction: float = 0.70,
    validation_fraction: float = 0.15,
) -> ChronologicalSplit:
    """Split by time and purge boundary rows whose targets cross windows."""

    if horizon_minutes not in TARGET_BY_HORIZON:
        raise FeaturePipelineError("horizon_minutes must be 30 or 60")
    if train_fraction <= 0 or validation_fraction <= 0:
        raise FeaturePipelineError("split fractions must be positive")
    if train_fraction + validation_fraction >= 1:
        raise FeaturePipelineError("train and validation fractions must leave a test window")

    target_column = TARGET_BY_HORIZON[horizon_minutes]
    if target_column not in feature_frame.columns:
        raise FeaturePipelineError(f"feature frame is missing {target_column}")
    eligible = feature_frame.loc[feature_frame[target_column].notna()].copy()
    timestamps = pd.Index(eligible["observed_at"].drop_duplicates().sort_values())
    if len(timestamps) < 20:
        raise FeaturePipelineError("at least 20 distinct timestamps are required for splitting")

    train_boundary = timestamps[int(len(timestamps) * train_fraction)]
    test_boundary = timestamps[int(len(timestamps) * (train_fraction + validation_fraction))]
    purge = pd.Timedelta(minutes=horizon_minutes)

    train = eligible.loc[eligible["observed_at"] < train_boundary - purge].copy()
    validation = eligible.loc[
        (eligible["observed_at"] >= train_boundary)
        & (eligible["observed_at"] < test_boundary - purge)
    ].copy()
    test = eligible.loc[eligible["observed_at"] >= test_boundary].copy()
    if train.empty or validation.empty or test.empty:
        raise FeaturePipelineError("chronological split produced an empty window")

    return ChronologicalSplit(
        train=train,
        validation=validation,
        test=test,
        train_boundary=train_boundary,
        test_boundary=test_boundary,
        purge_minutes=horizon_minutes,
    )


def model_feature_columns(feature_frame: pd.DataFrame) -> tuple[list[str], list[str]]:
    """Return stable numeric and categorical model inputs."""

    excluded = {"observed_at", *TARGET_BY_HORIZON.values()}
    categorical = ["station_id"]
    numeric = [
        column
        for column in feature_frame.columns
        if column not in excluded and column not in categorical
    ]
    return numeric, categorical


def _build_station_features(
    all_readings: pd.DataFrame,
    station_id: str,
    wbgt_rows: pd.DataFrame,
) -> pd.DataFrame:
    wbgt_rows = wbgt_rows.sort_values("observed_at").set_index("observed_at")
    regular_index = pd.date_range(
        wbgt_rows.index.min().floor("15min"),
        wbgt_rows.index.max().ceil("15min"),
        freq=SAMPLE_INTERVAL,
        tz="UTC",
    )
    wbgt = wbgt_rows["value"].reindex(regular_index)
    frame = pd.DataFrame(index=regular_index)
    frame["station_id"] = station_id
    frame["station_latitude"] = float(wbgt_rows["latitude"].iloc[0])
    frame["station_longitude"] = float(wbgt_rows["longitude"].iloc[0])
    frame["wbgt_t"] = wbgt

    for lag_minutes in (15, 30, 45, 60):
        frame[f"wbgt_lag_{lag_minutes}m"] = wbgt.shift(lag_minutes // 15)
    for window_minutes in (30, 60, 120):
        periods = window_minutes // 15
        rolling = wbgt.rolling(periods, min_periods=1)
        frame[f"wbgt_mean_{window_minutes}m"] = rolling.mean()
        frame[f"wbgt_min_{window_minutes}m"] = rolling.min()
        frame[f"wbgt_max_{window_minutes}m"] = rolling.max()
        frame[f"wbgt_slope_{window_minutes}m"] = (
            wbgt - wbgt.shift(periods - 1)
        ) / window_minutes

    station_latitude = float(wbgt_rows["latitude"].iloc[0])
    station_longitude = float(wbgt_rows["longitude"].iloc[0])
    for metric in SUPPORTING_METRICS:
        metric_rows = all_readings.loc[all_readings["metric"] == metric]
        values, freshness = _nearest_recent_station_series(
            metric_rows,
            station_latitude,
            station_longitude,
            regular_index,
        )
        frame[metric] = values
        frame[f"{metric}_freshness_minutes"] = freshness
        frame[f"{metric}_missing"] = values.isna().astype(int)
        if metric in {"air_temperature", "relative_humidity"}:
            frame[f"{metric}_lag_15m"] = values.shift(1)
            frame[f"{metric}_lag_30m"] = values.shift(2)

    wind_angle = np.deg2rad(frame.pop("wind_direction"))
    frame["wind_direction_sin"] = np.sin(wind_angle)
    frame["wind_direction_cos"] = np.cos(wind_angle)

    singapore_time = regular_index.tz_convert("Asia/Singapore")
    hour_angle = 2 * math.pi * (
        singapore_time.hour + singapore_time.minute / 60
    ) / 24
    day_angle = 2 * math.pi * singapore_time.dayofyear / 365.25
    frame["hour_sin"] = np.sin(hour_angle)
    frame["hour_cos"] = np.cos(hour_angle)
    frame["day_of_year_sin"] = np.sin(day_angle)
    frame["day_of_year_cos"] = np.cos(day_angle)
    frame["wbgt_missing_lag_count"] = frame[
        [f"wbgt_lag_{minutes}m" for minutes in (15, 30, 45, 60)]
    ].isna().sum(axis=1)
    frame["target_wbgt_30m"] = wbgt.shift(-2)
    frame["target_wbgt_60m"] = wbgt.shift(-4)
    return frame.rename_axis("observed_at").reset_index()


def _nearest_recent_station_series(
    metric_rows: pd.DataFrame,
    latitude: float,
    longitude: float,
    regular_index: pd.DatetimeIndex,
) -> tuple[pd.Series, pd.Series]:
    """Use the nearest station with a recent reading at each requested time."""

    if metric_rows.empty:
        missing = pd.Series(np.nan, index=regular_index, dtype=float)
        return missing, missing.copy()

    stations = metric_rows.drop_duplicates("station_id").copy()
    stations["distance_km"] = stations.apply(
        lambda station: _haversine_km(
            latitude,
            longitude,
            float(station["latitude"]),
            float(station["longitude"]),
        ),
        axis="columns",
    )
    stations = stations.sort_values(
        ["distance_km", "station_id"],
        kind="stable",
    )
    values = pd.Series(np.nan, index=regular_index, dtype=float)
    source_times = pd.Series(
        pd.NaT,
        index=regular_index,
        dtype="datetime64[ns, UTC]",
    )

    for station_id in stations["station_id"]:
        missing_times = values.index[values.isna()]
        if missing_times.empty:
            break

        station_rows = (
            metric_rows.loc[metric_rows["station_id"] == station_id]
            .sort_values("observed_at")
            .set_index("observed_at")
        )
        station_samples = pd.DataFrame(
            {
                "value": station_rows["value"].astype(float),
                "source_time": station_rows.index,
            },
            index=station_rows.index,
        )
        # Forward fill uses only observations available at prediction time.
        recent_samples = station_samples.reindex(
            missing_times,
            method="ffill",
            tolerance=SUPPORT_READING_MAX_AGE,
        ).dropna(subset=["value"])
        values.loc[recent_samples.index] = recent_samples["value"]
        source_times.loc[recent_samples.index] = recent_samples["source_time"]

    freshness = pd.Series(
        (
            pd.Series(regular_index, index=regular_index) - source_times
        ).dt.total_seconds()
        / 60,
        index=regular_index,
        dtype=float,
    )
    return values.astype(float), freshness


def _haversine_km(
    latitude_1: float,
    longitude_1: float,
    latitude_2: float,
    longitude_2: float,
) -> float:
    earth_radius_km = 6371.0088
    latitude_delta = math.radians(latitude_2 - latitude_1)
    longitude_delta = math.radians(longitude_2 - longitude_1)
    start_latitude = math.radians(latitude_1)
    end_latitude = math.radians(latitude_2)
    haversine = (
        math.sin(latitude_delta / 2) ** 2
        + math.cos(start_latitude)
        * math.cos(end_latitude)
        * math.sin(longitude_delta / 2) ** 2
    )
    return 2 * earth_radius_km * math.asin(math.sqrt(haversine))
