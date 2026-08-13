"""End-to-end test for training, evaluation, and artifact provenance."""

from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from subprocess import CompletedProcess
from unittest.mock import patch

from crewsafe_ml.inference import ForecastModelRegistry, ModelConfigurationError
from crewsafe_ml.training import INTERVAL_COVERAGE, RANDOM_SEED, _current_commit, train_and_package
from tests.test_features import synthetic_readings


class TrainingTest(unittest.TestCase):
    @patch("crewsafe_ml.training.subprocess.run")
    def test_marks_an_uncommitted_training_source_as_dirty(self, run) -> None:
        run.side_effect = [
            CompletedProcess([], 0, stdout="abc123\n", stderr=""),
            CompletedProcess([], 0, stdout=" M crewsafe_ml/training.py\n", stderr=""),
        ]

        self.assertEqual("abc123-dirty", _current_commit())

    def test_packages_both_horizons_with_metrics_and_provenance(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            dataset_path = root / "weather_readings.csv"
            dataset_manifest_path = root / "dataset-manifest.json"
            synthetic_readings(periods=160).to_csv(dataset_path, index=False)
            dataset_manifest_path.write_text(
                json.dumps(
                    {
                        "start_date": "2026-01-01",
                        "end_date": "2026-01-02",
                        "normalized_sha256": sha256(dataset_path),
                    }
                ),
                encoding="utf-8",
            )

            manifest_path = train_and_package(
                dataset_path=dataset_path,
                dataset_manifest_path=dataset_manifest_path,
                output_directory=root / "artifacts",
                model_version="test-model-1",
                source_commit="test-commit",
            )

            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual("test-model-1", manifest["model_version"])
            self.assertEqual("test-commit", manifest["source_commit"])
            self.assertEqual(2, manifest["schema_version"])
            self.assertEqual(RANDOM_SEED, manifest["training"]["random_seed"])
            self.assertEqual({"30", "60"}, set(manifest["horizons"]))
            self.assertTrue((manifest_path.parent / "evaluation-30m.json").is_file())
            self.assertTrue((manifest_path.parent / "evaluation-60m.json").is_file())
            for horizon in ("30", "60"):
                horizon_manifest = manifest["horizons"][horizon]
                self.assertIn("persistence", horizon_manifest["metrics"])
                self.assertEqual(
                    "validation",
                    horizon_manifest["prediction_interval"]["calibration_window"],
                )
                self.assertEqual(
                    INTERVAL_COVERAGE,
                    horizon_manifest["prediction_interval"]["target_coverage"],
                )
                self.assertGreater(
                    horizon_manifest["prediction_interval"]["calibration_sample_count"],
                    0,
                )
                self.assertGreaterEqual(horizon_manifest["training_seconds"], 0)
                self.assertEqual(8, len(horizon_manifest["validation_trials"]))
                self.assertIn("safety_floor", horizon_manifest["metrics"])
                self.assertTrue(
                    all(
                        "hyperparameters" in trial and "validation_metrics" in trial
                        for trial in horizon_manifest["validation_trials"]
                    )
                )
                evaluation = json.loads(
                    (manifest_path.parent / f"evaluation-{horizon}m.json").read_text(
                        encoding="utf-8"
                    )
                )
                self.assertEqual(
                    "validation",
                    evaluation["prediction_interval"]["calibration_window"],
                )
                self.assertEqual(
                    horizon_manifest["prediction_interval"]["calibration_sample_count"],
                    evaluation["split"]["validation_rows"],
                )
                artifact_name = horizon_manifest["artifact"]
                if artifact_name:
                    self.assertTrue((manifest_path.parent / artifact_name).is_file())
                    self.assertEqual(
                        sha256(manifest_path.parent / artifact_name),
                        manifest["horizons"][horizon]["artifact_sha256"],
                    )

            registry = ForecastModelRegistry.load(manifest_path, sha256(manifest_path))
            prediction = registry.predict(
                horizon_minutes=30,
                observations=forecast_observations(periods=9),
                station_id="WBGT-1",
                latitude=1.35,
                longitude=103.82,
            )
            self.assertTrue(20 <= prediction.predicted_value <= 60)
            self.assertTrue(prediction.model_version.startswith("test-model-1:"))

            with self.assertRaisesRegex(ModelConfigurationError, "checksum does not match"):
                ForecastModelRegistry.load(manifest_path, "0" * 64)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def forecast_observations(*, periods: int) -> list[dict[str, object]]:
    rows = synthetic_readings(periods=periods)
    observations: list[dict[str, object]] = []
    for timestamp, timestamp_rows in rows.groupby("observed_at", sort=True):
        observation: dict[str, object] = {"observed_at": timestamp}
        for row in timestamp_rows.to_dict("records"):
            observation[str(row["metric"])] = row["value"]
        observations.append(observation)
    return observations


if __name__ == "__main__":
    unittest.main()
