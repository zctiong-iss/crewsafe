"""Tests for leakage-safe WBGT feature preparation."""

from __future__ import annotations

import unittest

import numpy as np
import pandas as pd

from crewsafe_ml.features import (
    FeaturePipelineError,
    build_feature_frame,
    chronological_split,
)


class FeaturePipelineTest(unittest.TestCase):
    def test_targets_and_lags_use_expected_timestamps(self) -> None:
        readings = synthetic_readings(periods=32)

        features = build_feature_frame(readings)

        row = features.iloc[4]
        self.assertEqual(24.4, row["wbgt_t"])
        self.assertEqual(24.3, row["wbgt_lag_15m"])
        self.assertEqual(24.0, row["wbgt_lag_60m"])
        self.assertEqual(24.6, row["target_wbgt_30m"])
        self.assertEqual(24.8, row["target_wbgt_60m"])

    def test_does_not_interpolate_missing_wbgt(self) -> None:
        readings = synthetic_readings(periods=32)
        missing_time = readings.loc[readings["metric"] == "wbgt", "observed_at"].iloc[8]
        readings = readings.loc[
            ~((readings["metric"] == "wbgt") & (readings["observed_at"] == missing_time))
        ]

        features = build_feature_frame(readings)

        self.assertFalse((features["observed_at"] == missing_time).any())
        following = features.loc[
            features["observed_at"] == missing_time + pd.Timedelta(minutes=15)
        ].iloc[0]
        self.assertTrue(np.isnan(following["wbgt_lag_15m"]))

    def test_uses_nearest_supporting_station_and_records_freshness(self) -> None:
        readings = synthetic_readings(periods=32, support_offset_minutes=-1)
        far_station = readings.loc[readings["metric"] == "air_temperature"].copy()
        far_station["station_id"] = "TEMP-FAR"
        far_station["latitude"] = 1.0
        far_station["longitude"] = 104.4
        far_station["value"] = 99.0
        readings = pd.concat([readings, far_station], ignore_index=True)

        features = build_feature_frame(readings)

        self.assertAlmostEqual(28.0, features.iloc[0]["air_temperature"])
        self.assertAlmostEqual(1.0, features.iloc[0]["air_temperature_freshness_minutes"])

    def test_uses_next_nearest_station_while_closest_station_is_silent(self) -> None:
        readings = synthetic_readings(periods=32)
        closest_temperature = readings.loc[
            readings["metric"] == "air_temperature"
        ].copy()
        working_temperature = closest_temperature.copy()
        working_temperature["station_id"] = "TEMP-WORKING"
        working_temperature["station_name"] = "TEMP-WORKING"
        working_temperature["latitude"] = 1.352
        working_temperature["longitude"] = 103.822
        working_temperature["value"] = 30.0

        # The closest station reports at the first and third WBGT timestamps,
        # but is too old to use at the timestamp between them.
        closest_temperature = closest_temperature.iloc[[0, 2]]
        readings = readings.loc[readings["metric"] != "air_temperature"]
        readings = pd.concat(
            [readings, closest_temperature, working_temperature],
            ignore_index=True,
        )

        features = build_feature_frame(readings)

        self.assertAlmostEqual(28.0, features.iloc[0]["air_temperature"])
        self.assertAlmostEqual(30.0, features.iloc[1]["air_temperature"])
        self.assertAlmostEqual(28.1, features.iloc[2]["air_temperature"])
        self.assertEqual(0, features.iloc[1]["air_temperature_missing"])
        self.assertAlmostEqual(
            0.0,
            features.iloc[1]["air_temperature_freshness_minutes"],
        )

    def test_never_uses_a_future_supporting_weather_reading(self) -> None:
        readings = synthetic_readings(periods=32, support_offset_minutes=7)

        features = build_feature_frame(readings)

        self.assertTrue(np.isnan(features.iloc[0]["air_temperature"]))
        self.assertAlmostEqual(28.0, features.iloc[1]["air_temperature"])
        self.assertAlmostEqual(
            8.0,
            features.iloc[1]["air_temperature_freshness_minutes"],
        )

    def test_chronological_split_purges_cross_boundary_targets(self) -> None:
        features = build_feature_frame(synthetic_readings(periods=80))

        split = chronological_split(features, horizon_minutes=60)

        self.assertLess(
            split.train["observed_at"].max() + pd.Timedelta(minutes=60),
            split.train_boundary,
        )
        self.assertGreaterEqual(split.validation["observed_at"].min(), split.train_boundary)
        self.assertLess(
            split.validation["observed_at"].max() + pd.Timedelta(minutes=60),
            split.test_boundary,
        )
        self.assertGreaterEqual(split.test["observed_at"].min(), split.test_boundary)

    def test_rejects_too_little_data_for_safe_split(self) -> None:
        features = build_feature_frame(synthetic_readings(periods=12))

        with self.assertRaisesRegex(FeaturePipelineError, "at least 20"):
            chronological_split(features, horizon_minutes=30)


def synthetic_readings(
    *,
    periods: int,
    support_offset_minutes: int = 0,
) -> pd.DataFrame:
    timestamps = pd.date_range("2026-01-01", periods=periods, freq="15min", tz="UTC")
    rows: list[dict[str, object]] = []
    for index, timestamp in enumerate(timestamps):
        rows.append(
            reading(
                metric="wbgt",
                observed_at=timestamp,
                station_id="WBGT-1",
                latitude=1.35,
                longitude=103.82,
                value=24.0 + index / 10,
            )
        )
        for metric, station_id, value in (
            ("air_temperature", "TEMP-NEAR", 28.0 + index / 20),
            ("relative_humidity", "HUMIDITY-NEAR", 75.0 - index / 20),
            ("wind_speed", "WIND-NEAR", 4.0),
            ("wind_direction", "DIRECTION-NEAR", 180.0),
            ("rainfall", "RAIN-NEAR", 0.0),
        ):
            rows.append(
                reading(
                    metric=metric,
                    observed_at=timestamp + pd.Timedelta(minutes=support_offset_minutes),
                    station_id=station_id,
                    latitude=1.351,
                    longitude=103.821,
                    value=value,
                )
            )
    return pd.DataFrame(rows)


def reading(
    *,
    metric: str,
    observed_at: pd.Timestamp,
    station_id: str,
    latitude: float,
    longitude: float,
    value: float,
) -> dict[str, object]:
    return {
        "metric": metric,
        "observed_at": observed_at,
        "station_id": station_id,
        "station_name": station_id,
        "latitude": latitude,
        "longitude": longitude,
        "value": value,
        "unit": "unit",
        "heat_stress": "",
    }


if __name__ == "__main__":
    unittest.main()
