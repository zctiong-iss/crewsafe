"""Tests for frozen-model evaluation on an untouched approval period."""

from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import joblib
import pandas as pd
from sklearn.dummy import DummyRegressor

from crewsafe_ml.approval_evaluation import (
    ApprovalEvaluationError,
    evaluate_frozen_candidate,
)
from crewsafe_ml.features import FEATURE_VERSION


HORIZONS_KEY = "horizons"
SELECTED_MODEL_KEY = "selected_model"
ARTIFACT_KEY = "artifact"
ARTIFACT_SHA256_KEY = "artifact_sha256"


class ApprovalEvaluationTest(unittest.TestCase):
    def test_reports_ready_without_changing_the_model_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest_path, feature_path, feature_manifest_path = build_fixture(root)
            original_manifest = manifest_path.read_bytes()

            report = evaluate_frozen_candidate(
                model_manifest_path=manifest_path,
                expected_model_manifest_sha256=sha256(manifest_path),
                feature_path=feature_path,
                feature_manifest_path=feature_manifest_path,
                workspace_root=root,
                minimum_untouched_days=2,
            )

            self.assertEqual("READY_FOR_HUMAN_REVIEW", report["decision"])
            self.assertTrue(report["automated_checks_passed"])
            self.assertTrue(report["horizons"]["30"]["passes_safety_rule"])
            self.assertEqual(original_manifest, manifest_path.read_bytes())

    def test_blocks_a_dirty_source_and_short_period(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest_path, feature_path, feature_manifest_path = build_fixture(
                root,
                source_commit="a" * 40 + "-dirty",
            )

            report = evaluate_frozen_candidate(
                model_manifest_path=manifest_path,
                expected_model_manifest_sha256=sha256(manifest_path),
                feature_path=feature_path,
                feature_manifest_path=feature_manifest_path,
                workspace_root=root,
                minimum_untouched_days=21,
            )

            self.assertEqual("BLOCKED", report["decision"])
            self.assertFalse(report["gates"]["source_commit_is_reviewable"])
            self.assertFalse(report["gates"]["minimum_untouched_period_days_met"])

    def test_blocks_data_collected_before_the_candidate_was_frozen(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest_path, feature_path, feature_manifest_path = build_fixture(
                root,
                candidate_created_at="2026-08-02T12:00:00+00:00",
            )

            report = evaluate_frozen_candidate(
                model_manifest_path=manifest_path,
                expected_model_manifest_sha256=sha256(manifest_path),
                feature_path=feature_path,
                feature_manifest_path=feature_manifest_path,
                workspace_root=root,
                minimum_untouched_days=2,
            )

            self.assertEqual("BLOCKED", report["decision"])
            self.assertFalse(
                report["gates"]["period_starts_after_candidate_was_frozen"]
            )

    def test_rejects_a_changed_model_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest_path, feature_path, feature_manifest_path = build_fixture(root)
            checksum = sha256(manifest_path)
            manifest_path.write_text("{}\n", encoding="utf-8")

            with self.assertRaisesRegex(ApprovalEvaluationError, "checksum"):
                evaluate_frozen_candidate(
                    model_manifest_path=manifest_path,
                    expected_model_manifest_sha256=checksum,
                    feature_path=feature_path,
                    feature_manifest_path=feature_manifest_path,
                    workspace_root=root,
                )

    def test_evaluates_a_persistence_candidate_without_an_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest_path, feature_path, feature_manifest_path = build_fixture(root)
            manifest = read_json(manifest_path)
            for configuration in manifest[HORIZONS_KEY].values():
                configuration[SELECTED_MODEL_KEY] = "persistence"
                configuration.pop(ARTIFACT_KEY)
                configuration.pop(ARTIFACT_SHA256_KEY)
            write_json(manifest_path, manifest)

            report = evaluate_frozen_candidate(
                model_manifest_path=manifest_path,
                expected_model_manifest_sha256=sha256(manifest_path),
                feature_path=feature_path,
                feature_manifest_path=feature_manifest_path,
                workspace_root=root,
                minimum_untouched_days=2,
            )

            self.assertEqual(
                report["horizons"]["30"]["candidate"],
                report["horizons"]["30"]["persistence"],
            )

    def test_rejects_an_artifact_path_outside_the_model_bundle(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest_path, feature_path, feature_manifest_path = build_fixture(root)
            manifest = read_json(manifest_path)
            manifest[HORIZONS_KEY]["30"][ARTIFACT_KEY] = "../forecast-30m.joblib"
            write_json(manifest_path, manifest)

            with self.assertRaisesRegex(ApprovalEvaluationError, "artifact name"):
                evaluate_frozen_candidate(
                    model_manifest_path=manifest_path,
                    expected_model_manifest_sha256=sha256(manifest_path),
                    feature_path=feature_path,
                    feature_manifest_path=feature_manifest_path,
                    workspace_root=root,
                )

    def test_rejects_an_artifact_with_the_wrong_checksum(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest_path, feature_path, feature_manifest_path = build_fixture(root)
            manifest = read_json(manifest_path)
            manifest[HORIZONS_KEY]["30"][ARTIFACT_SHA256_KEY] = "0" * 64
            write_json(manifest_path, manifest)

            with self.assertRaisesRegex(ApprovalEvaluationError, "artifact checksum"):
                evaluate_frozen_candidate(
                    model_manifest_path=manifest_path,
                    expected_model_manifest_sha256=sha256(manifest_path),
                    feature_path=feature_path,
                    feature_manifest_path=feature_manifest_path,
                    workspace_root=root,
                )

    def test_rejects_out_of_range_model_predictions(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest_path, feature_path, feature_manifest_path = build_fixture(root)
            manifest = read_json(manifest_path)
            artifact_path = (
                manifest_path.parent / manifest[HORIZONS_KEY]["30"][ARTIFACT_KEY]
            )
            feature_frame = pd.read_csv(feature_path)
            model = DummyRegressor(strategy="constant", constant=61.0)
            model.fit(
                feature_frame[["wbgt_t", "station_id"]],
                [61.0] * len(feature_frame),
            )
            joblib.dump(model, artifact_path)
            manifest[HORIZONS_KEY]["30"][ARTIFACT_SHA256_KEY] = sha256(artifact_path)
            write_json(manifest_path, manifest)

            with self.assertRaisesRegex(ApprovalEvaluationError, "out-of-range"):
                evaluate_frozen_candidate(
                    model_manifest_path=manifest_path,
                    expected_model_manifest_sha256=sha256(manifest_path),
                    feature_path=feature_path,
                    feature_manifest_path=feature_manifest_path,
                    workspace_root=root,
                )


def build_fixture(
    root: Path,
    *,
    source_commit: str = "a" * 40,
    candidate_created_at: str = "2026-07-31T12:00:00+00:00",
) -> tuple[Path, Path, Path]:
    bundle = root / "model"
    bundle.mkdir()
    feature_frame = pd.DataFrame(
        {
            "observed_at": pd.date_range("2026-08-01", periods=8, freq="6h", tz="UTC"),
            "station_id": ["S1"] * 8,
            "wbgt_t": [32.0] * 8,
            "target_wbgt_30m": [33.0] * 8,
            "target_wbgt_60m": [33.0] * 8,
        }
    )
    feature_path = root / "weather_features_15min.csv"
    feature_frame.to_csv(feature_path, index=False)
    feature_manifest_path = root / "dataset-manifest.json"
    feature_manifest_path.write_text(
        json.dumps(
            {
                "start_date": "2026-08-01",
                "end_date": "2026-08-02",
                "prepared_15_minute_dataset": {
                    "file": feature_path.name,
                    "feature_version": FEATURE_VERSION,
                    "sha256": sha256(feature_path),
                    "row_count": len(feature_frame),
                },
            }
        ),
        encoding="utf-8",
    )

    horizons: dict[str, object] = {}
    for horizon in (30, 60):
        model = DummyRegressor(strategy="constant", constant=33.0)
        model.fit(feature_frame[["wbgt_t", "station_id"]], [33.0] * len(feature_frame))
        artifact_path = bundle / f"forecast-{horizon}m.joblib"
        joblib.dump(model, artifact_path)
        horizons[str(horizon)] = {
            SELECTED_MODEL_KEY: "test-candidate",
            ARTIFACT_KEY: artifact_path.name,
            ARTIFACT_SHA256_KEY: sha256(artifact_path),
            "interval_half_width": 1.0,
        }
    manifest_path = bundle / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "schema_version": 2,
                "model_version": "frozen-test-model",
                "approved_for_inference": False,
                "feature_version": FEATURE_VERSION,
                "created_at": candidate_created_at,
                "source_commit": source_commit,
                "dataset": {"start_date": "2026-01-01", "end_date": "2026-07-31"},
                "numeric_features": ["wbgt_t"],
                "categorical_features": ["station_id"],
                HORIZONS_KEY: horizons,
            }
        ),
        encoding="utf-8",
    )
    return manifest_path, feature_path, feature_manifest_path


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload), encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
