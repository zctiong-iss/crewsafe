"""Coverage for GET /model/status's status-reporting logic (SCRUM-150)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from crewsafe_ml.model_status import (
    BASELINE_MODEL_VERSION,
    NO_MODEL_CONFIGURED,
    current_model_status,
)

BUNDLE_DIRECTORY = Path(__file__).resolve().parents[1] / "model-bundle" / "staging-demo-v1"
MANIFEST_PATH = BUNDLE_DIRECTORY / "manifest.json"
MANIFEST_CHECKSUM_PATH = BUNDLE_DIRECTORY / "manifest.sha256"


def test_reports_unconfigured_status_when_env_vars_are_absent(monkeypatch):
    """No model configured is a reportable status, not a crash."""

    monkeypatch.delenv("WBGT_MODEL_MANIFEST", raising=False)
    monkeypatch.delenv("WBGT_MODEL_MANIFEST_SHA256", raising=False)

    status = current_model_status()

    assert status == {
        "model_version": BASELINE_MODEL_VERSION,
        "approved_for_inference": False,
        "approval_blocker": NO_MODEL_CONFIGURED,
        "horizons": {},
    }


def test_reports_unconfigured_status_when_manifest_is_missing(monkeypatch):
    """An unreadable/missing manifest degrades to the same honest status, not an error."""

    monkeypatch.setenv("WBGT_MODEL_MANIFEST", "/private/missing/manifest.json")
    monkeypatch.setenv("WBGT_MODEL_MANIFEST_SHA256", "0" * 64)

    status = current_model_status()

    assert status["approved_for_inference"] is False
    assert status["approval_blocker"] == NO_MODEL_CONFIGURED
    assert status["horizons"] == {}


def test_reports_unconfigured_status_when_checksum_does_not_match(monkeypatch):
    """A tampered or stale checksum must never surface a manifest's contents."""

    monkeypatch.setenv("WBGT_MODEL_MANIFEST", str(MANIFEST_PATH))
    monkeypatch.setenv("WBGT_MODEL_MANIFEST_SHA256", "0" * 64)

    status = current_model_status()

    assert status["approved_for_inference"] is False
    assert status["approval_blocker"] == NO_MODEL_CONFIGURED
    assert status["horizons"] == {}


def test_reports_configured_bundle_status_and_metrics_matching_the_manifest(monkeypatch):
    """Metrics returned must match the evaluation artifact exactly (SCRUM-150 acceptance)."""

    expected_checksum = MANIFEST_CHECKSUM_PATH.read_text(encoding="utf-8").strip()
    monkeypatch.setenv("WBGT_MODEL_MANIFEST", str(MANIFEST_PATH))
    monkeypatch.setenv("WBGT_MODEL_MANIFEST_SHA256", expected_checksum)

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))

    status = current_model_status()

    assert status["model_version"] == manifest["model_version"]
    assert status["approved_for_inference"] == manifest["approved_for_inference"]
    assert status["approval_blocker"] == manifest.get("approval_blocker")
    assert set(status["horizons"].keys()) == {"30", "60"}
    for horizon in ("30", "60"):
        assert status["horizons"][horizon] == manifest["horizons"][horizon]["metrics"]["candidate"]


def test_ignores_horizons_missing_candidate_metrics(monkeypatch, tmp_path):
    """A manifest whose horizon lacks metrics must not raise; that horizon is simply absent."""

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    del manifest["horizons"]["60"]["metrics"]
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    import hashlib

    checksum = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
    monkeypatch.setenv("WBGT_MODEL_MANIFEST", str(manifest_path))
    monkeypatch.setenv("WBGT_MODEL_MANIFEST_SHA256", checksum)

    status = current_model_status()

    assert set(status["horizons"].keys()) == {"30"}
