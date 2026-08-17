"""HTTP-layer coverage for GET /model/status (SCRUM-150)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import app

BUNDLE_DIRECTORY = Path(__file__).resolve().parent / "model-bundle" / "staging-demo-v1"
MANIFEST_PATH = BUNDLE_DIRECTORY / "manifest.json"
MANIFEST_CHECKSUM_PATH = BUNDLE_DIRECTORY / "manifest.sha256"


@pytest.fixture(name="client")
def _client():
    return TestClient(app)


def test_model_status_reports_unconfigured_by_default(client, monkeypatch):
    monkeypatch.delenv("WBGT_MODEL_MANIFEST", raising=False)
    monkeypatch.delenv("WBGT_MODEL_MANIFEST_SHA256", raising=False)

    response = client.get("/model/status")

    assert response.status_code == 200
    body = response.json()
    assert body["model_version"] == "baseline-1.0.0"
    assert body["approved_for_inference"] is False
    assert body["approval_blocker"] == "no model configured"
    assert body["horizons"] == {}


def test_model_status_matches_the_configured_evaluation_artifact(client, monkeypatch):
    expected_checksum = MANIFEST_CHECKSUM_PATH.read_text(encoding="utf-8").strip()
    monkeypatch.setenv("WBGT_MODEL_MANIFEST", str(MANIFEST_PATH))
    monkeypatch.setenv("WBGT_MODEL_MANIFEST_SHA256", expected_checksum)
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))

    response = client.get("/model/status")

    assert response.status_code == 200
    body = response.json()
    assert body["model_version"] == manifest["model_version"]
    assert body["approved_for_inference"] == manifest["approved_for_inference"]
    for horizon in ("30", "60"):
        assert body["horizons"][horizon]["mae"] == manifest["horizons"][horizon]["metrics"]["candidate"]["mae"]
        assert (
            body["horizons"][horizon]["sample_count"]
            == manifest["horizons"][horizon]["metrics"]["candidate"]["sample_count"]
        )
