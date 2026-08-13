"""Tests for leakage-safe rolling chronological windows."""

from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import pandas as pd

from crewsafe_ml.backtest import _verified_feature_manifest
from crewsafe_ml.backtesting import expanding_rolling_windows
from crewsafe_ml.features import FEATURE_VERSION


class RollingWindowTest(unittest.TestCase):
    def test_accepts_the_manifest_created_by_the_downloader(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            feature_path = root / "weather_features_15min.csv"
            manifest_path = root / "manifest.json"
            feature_path.write_text("observed_at,wbgt_t\n", encoding="utf-8")
            checksum = hashlib.sha256(feature_path.read_bytes()).hexdigest()
            manifest_path.write_text(
                json.dumps(
                    {
                        "start_date": "2026-01-01",
                        "end_date": "2026-01-31",
                        "prepared_15_minute_dataset": {
                            "feature_version": FEATURE_VERSION,
                            "sha256": checksum,
                        },
                    }
                ),
                encoding="utf-8",
            )

            manifest = _verified_feature_manifest(manifest_path, feature_path)

            self.assertEqual(
                FEATURE_VERSION,
                manifest["prepared_15_minute_dataset"]["feature_version"],
            )

    def test_windows_are_ordered_purged_and_non_overlapping(self) -> None:
        timestamps = pd.date_range("2026-01-01", periods=24 * 12, freq="6h", tz="UTC")
        frame = pd.DataFrame(
            {
                "observed_at": timestamps,
                "target_wbgt_30m": 30.0,
                "target_wbgt_60m": 30.0,
            }
        )

        windows = expanding_rolling_windows(
            frame,
            horizon_minutes=60,
            minimum_training_days=14,
            validation_days=7,
            test_days=7,
            evaluation_end=pd.Timestamp("2026-03-20T00:00:00Z"),
        )

        self.assertGreaterEqual(len(windows), 2)
        for previous, current in zip(windows, windows[1:]):
            self.assertEqual(previous.test_end, current.split.test_boundary)
        for window in windows:
            split = window.split
            self.assertLess(
                split.train["observed_at"].max(),
                split.train_boundary - pd.Timedelta(minutes=60),
            )
            self.assertLess(
                split.validation["observed_at"].max(),
                split.test_boundary - pd.Timedelta(minutes=60),
            )
            self.assertGreaterEqual(split.test["observed_at"].min(), split.test_boundary)
            self.assertLess(split.test["observed_at"].max(), window.test_end)

    def test_rejects_an_evaluation_end_without_timezone(self) -> None:
        frame = pd.DataFrame(
            {
                "observed_at": pd.date_range(
                    "2026-01-01", periods=100, freq="6h", tz="UTC"
                ),
                "target_wbgt_30m": 30.0,
            }
        )

        with self.assertRaisesRegex(ValueError, "timezone"):
            expanding_rolling_windows(
                frame,
                horizon_minutes=30,
                minimum_training_days=2,
                validation_days=2,
                test_days=2,
                evaluation_end=pd.Timestamp("2026-01-20"),
            )


if __name__ == "__main__":
    unittest.main()
