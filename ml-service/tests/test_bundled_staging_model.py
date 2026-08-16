"""Integrity and inference checks for the reviewed staging-demo bundle."""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

import pytest

from crewsafe_ml.inference import ForecastModelRegistry, ModelConfigurationError


BUNDLE_DIRECTORY = (
    Path(__file__).resolve().parents[1] / "model-bundle" / "staging-demo-v1"
)
MANIFEST_PATH = BUNDLE_DIRECTORY / "manifest.json"
MANIFEST_CHECKSUM_PATH = BUNDLE_DIRECTORY / "manifest.sha256"


def sha256(path: Path) -> str:
    """Return the lowercase SHA-256 for one bundle file."""

    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(64 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def test_staging_bundle_has_explicit_limited_approval() -> None:
    """The demo exception must never look like production approval."""

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))

    assert manifest["approved_for_inference"] is True
    assert manifest["approval_scope"] == "STAGING_DEMO_ONLY"
    assert manifest["production_approved"] is False
    assert manifest["approval"]["decision_owner"] == "Bryan Phang"
    assert manifest["approval"]["review_status"] == (
        "OWNER_ACCEPTED_STAGING_DEMO_EXCEPTION"
    )
    assert "approval_blocker" not in manifest
    assert "staging-demo" in manifest["model_version"]


def test_staging_bundle_checksums_and_loader() -> None:
    """Every committed binary must match the reviewed manifest before loading."""

    expected_manifest_checksum = MANIFEST_CHECKSUM_PATH.read_text(
        encoding="utf-8"
    ).strip()
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))

    assert sha256(MANIFEST_PATH) == expected_manifest_checksum
    for horizon in (30, 60):
        configuration = manifest["horizons"][str(horizon)]
        artifact_path = BUNDLE_DIRECTORY / configuration["artifact"]
        assert sha256(artifact_path) == configuration["artifact_sha256"]

    registry = ForecastModelRegistry.load(
        MANIFEST_PATH,
        expected_manifest_checksum,
    )
    for horizon in (30, 60):
        prediction = registry.predict(
            horizon_minutes=horizon,
            observations=recent_observations(),
            station_id="S123",
            latitude=1.3521,
            longitude=103.8198,
        )
        assert math.isfinite(prediction.predicted_value)
        assert 0 <= prediction.predicted_value <= 60
        assert prediction.predicted_value >= 31.2
        assert prediction.model_version.startswith(
            "wbgt-six-month-safety-floor-staging-demo-v1:"
        )
        assert prediction.interval_half_width > 0


def test_wrong_manifest_checksum_is_rejected() -> None:
    """A changed manifest cannot be loaded with the reviewed checksum."""

    with pytest.raises(ModelConfigurationError, match="checksum does not match"):
        ForecastModelRegistry.load(MANIFEST_PATH, "0" * 64)


def recent_observations() -> list[dict[str, object]]:
    """Return a small, timezone-aware sequence accepted by feature preparation."""

    return [
        {
            "observed_at": "2026-08-16T01:00:00+00:00",
            "wbgt": 30.8,
            "air_temperature": 30.0,
            "relative_humidity": 72.0,
            "wind_speed": 2.4,
            "wind_direction": 170.0,
            "rainfall": 0.0,
        },
        {
            "observed_at": "2026-08-16T01:15:00+00:00",
            "wbgt": 31.0,
            "air_temperature": 30.2,
            "relative_humidity": 71.0,
            "wind_speed": 2.6,
            "wind_direction": 175.0,
            "rainfall": 0.0,
        },
        {
            "observed_at": "2026-08-16T01:30:00+00:00",
            "wbgt": 31.1,
            "air_temperature": 30.4,
            "relative_humidity": 70.0,
            "wind_speed": 2.8,
            "wind_direction": 180.0,
            "rainfall": 0.0,
        },
        {
            "observed_at": "2026-08-16T01:45:00+00:00",
            "wbgt": 31.2,
            "air_temperature": 30.5,
            "relative_humidity": 69.0,
            "wind_speed": 3.0,
            "wind_direction": 185.0,
            "rainfall": 0.0,
        },
    ]
