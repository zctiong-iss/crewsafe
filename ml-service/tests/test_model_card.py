"""Coverage for GET /model/card's status-reporting logic (SCRUM-152)."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from crewsafe_ml.model_card import current_model_card

BUNDLE_DIRECTORY = Path(__file__).resolve().parents[1] / "model-bundle" / "staging-demo-v1"
MANIFEST_PATH = BUNDLE_DIRECTORY / "manifest.json"
MANIFEST_CHECKSUM_PATH = BUNDLE_DIRECTORY / "manifest.sha256"


def test_reports_unconfigured_card_when_env_vars_are_absent(monkeypatch):
    monkeypatch.delenv("WBGT_MODEL_MANIFEST", raising=False)
    monkeypatch.delenv("WBGT_MODEL_MANIFEST_SHA256", raising=False)

    card = current_model_card()

    assert card == {"model_version": "baseline-1.0.0", "horizons": {}}


def test_reports_shap_computed_false_for_a_bundle_that_predates_shap(monkeypatch):
    """The real committed staging bundle was trained before SCRUM-152."""

    expected_checksum = MANIFEST_CHECKSUM_PATH.read_text(encoding="utf-8").strip()
    monkeypatch.setenv("WBGT_MODEL_MANIFEST", str(MANIFEST_PATH))
    monkeypatch.setenv("WBGT_MODEL_MANIFEST_SHA256", expected_checksum)
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    assert "shap_drivers" not in manifest["horizons"]["30"]  # sanity: confirms the fixture's premise

    card = current_model_card()

    assert card["model_version"] == manifest["model_version"]
    assert set(card["horizons"].keys()) == {"30", "60"}
    for horizon in ("30", "60"):
        horizon_card = card["horizons"][horizon]
        assert horizon_card["shap_drivers"] == []
        assert horizon_card["shap_computed"] is False
        assert horizon_card["calibration"] == {
            "target_coverage": manifest["horizons"][horizon]["prediction_interval"]["target_coverage"],
            "final_test_coverage": manifest["horizons"][horizon]["prediction_interval"][
                "final_test_coverage"
            ],
            "calibration_sample_count": manifest["horizons"][horizon]["prediction_interval"][
                "calibration_sample_count"
            ],
        }
        assert horizon_card["mae_by_actual_band"] == (
            manifest["horizons"][horizon]["metrics"]["candidate"]["mae_by_actual_band"]
        )


def test_reports_shap_drivers_when_present_in_the_manifest(monkeypatch, tmp_path):
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    manifest["horizons"]["30"]["shap_drivers"] = [
        {"feature": "wbgt_lag_15m", "mean_abs_shap": 0.42},
        {"feature": "air_temperature", "mean_abs_shap": 0.11},
    ]
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    checksum = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
    monkeypatch.setenv("WBGT_MODEL_MANIFEST", str(manifest_path))
    monkeypatch.setenv("WBGT_MODEL_MANIFEST_SHA256", checksum)

    card = current_model_card()

    horizon_30 = card["horizons"]["30"]
    assert horizon_30["shap_computed"] is True
    assert horizon_30["shap_drivers"] == [
        {"feature": "wbgt_lag_15m", "mean_abs_shap": 0.42},
        {"feature": "air_temperature", "mean_abs_shap": 0.11},
    ]
    # Horizon 60 in this fixture still has no shap_drivers - only 30 was mutated.
    assert card["horizons"]["60"]["shap_computed"] is False


def test_omits_a_horizon_with_no_mae_by_actual_band(monkeypatch, tmp_path):
    """A horizon missing its evaluation metrics entirely is dropped, not half-reported."""

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    del manifest["horizons"]["60"]["metrics"]
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    checksum = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
    monkeypatch.setenv("WBGT_MODEL_MANIFEST", str(manifest_path))
    monkeypatch.setenv("WBGT_MODEL_MANIFEST_SHA256", checksum)

    card = current_model_card()

    assert set(card["horizons"].keys()) == {"30"}
