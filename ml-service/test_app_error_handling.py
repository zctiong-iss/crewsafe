"""Runtime error-handling contracts for the FastAPI layer (SCRUM-407).

SonarQube flagged a cluster of findings in `app.py`'s exception handling. Two of them were not
style issues at all — they were behavioural bugs that a reader of the source would reasonably
believe worked:

* `python:S1045` — `BedrockModelAccessError` subclasses `BedrockAccessError`, and the parent was
  listed first, so the model-access branch was unreachable dead code. The `X-Fallback-Region`
  header it exists to send could never be sent, and a caller hitting a region-availability
  problem was told only "Bedrock is unavailable", with no hint that another region would work.
* `/bedrock/access` returned `(body, 503)`. FastAPI has no Flask-style tuple-to-status
  convention, so that serialised into a two-element JSON array and answered **200 OK while
  Bedrock was down** — precisely inverting the meaning of the endpoint a health probe polls.

Both are the kind of defect that only shows up when the failure path actually runs, which is
why they are pinned here rather than left to inspection.
"""
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

import app as app_module
from app import INTERNAL_SERVER_ERROR, app
from bedrock_client import BedrockAccessError, BedrockModelAccessError

VALID_CONTEXT = {"context": "Current WBGT 33.2C, 6 workers on site, heavy work."}


@pytest.fixture(name="client")
def _client():
    return TestClient(app)


@pytest.fixture(name="stub_bedrock")
def _stub_bedrock():
    """Swap the module-level client and always put the real one back."""
    original = app_module.bedrock_client

    def install(**attrs):
        stub = Mock()
        stub.region = "ap-southeast-1"
        for key, value in attrs.items():
            setattr(stub, key, value)
        app_module.bedrock_client = stub
        return stub

    yield install
    app_module.bedrock_client = original


# ----------------------------------------------------------------------------------
# python:S1045 — the unreachable handler
# ----------------------------------------------------------------------------------


def test_model_access_failure_reaches_its_own_handler(client, stub_bedrock):
    """The regression: this branch was dead code while the parent class was caught first."""
    stub_bedrock(invoke=Mock(side_effect=BedrockModelAccessError("model gone in region")))

    response = client.post("/bedrock/suggest", json=VALID_CONTEXT)

    assert response.status_code == 503
    assert response.headers.get("X-Fallback-Region") == "us-east-1"
    assert "Fallback: try us-east-1" in response.json()["detail"]


def test_generic_access_failure_does_not_claim_a_fallback_region(client, stub_bedrock):
    """Reordering must not make every access failure look region-recoverable."""
    stub_bedrock(invoke=Mock(side_effect=BedrockAccessError("no credentials")))

    response = client.post("/bedrock/suggest", json=VALID_CONTEXT)

    assert response.status_code == 503
    assert response.headers.get("X-Fallback-Region") is None
    assert response.json()["detail"] == "no credentials"


# ----------------------------------------------------------------------------------
# /bedrock/access — the 200-while-broken bug
# ----------------------------------------------------------------------------------


def test_access_check_reports_503_when_bedrock_is_unreachable(client, stub_bedrock):
    """A health probe must not read "Bedrock is fine" out of a Bedrock outage."""
    stub_bedrock(verify_access=Mock(side_effect=BedrockAccessError("model not available here")))

    response = client.get("/bedrock/access")

    assert response.status_code == 503
    body = response.json()
    assert isinstance(body, dict), "a (body, status) tuple serialises as a JSON array, not an object"
    assert body["status"] == "error"
    assert body["recommendation"] == "Try fallback region us-east-1"


def test_access_check_recommends_iam_when_the_cause_is_not_availability(client, stub_bedrock):
    stub_bedrock(verify_access=Mock(side_effect=BedrockAccessError("AccessDeniedException")))

    body = client.get("/bedrock/access").json()

    assert body["recommendation"] == "Check IAM permissions"


def test_access_check_is_200_when_bedrock_is_reachable(client, stub_bedrock):
    stub_bedrock(verify_access=Mock(return_value=(True, "confirmed")))

    response = client.get("/bedrock/access")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "message": "confirmed",
        "region": "ap-southeast-1",
    }


def test_access_check_is_503_before_the_client_is_initialised(client, stub_bedrock):
    app_module.bedrock_client = None

    response = client.get("/bedrock/access")

    assert response.status_code == 503


# ----------------------------------------------------------------------------------
# Response hygiene — a client never receives raw exception text
# ----------------------------------------------------------------------------------


def test_unexpected_failure_does_not_leak_exception_detail(client, stub_bedrock):
    """The catch-all must return the fixed constant, never the underlying message."""
    stub_bedrock(invoke=Mock(side_effect=RuntimeError("/srv/secret/path.py exploded")))

    response = client.post("/bedrock/suggest", json=VALID_CONTEXT)

    assert response.status_code == 500
    assert response.json()["detail"] == INTERNAL_SERVER_ERROR
    assert "secret" not in response.text


def test_schema_validation_failure_is_502_not_500(client, stub_bedrock):
    """A model returning an unusable shape is a bad gateway, not our own crash."""
    stub_bedrock(invoke=Mock(side_effect=ValueError("mitigations[0].actionCode missing")))

    response = client.post("/bedrock/suggest", json=VALID_CONTEXT)

    assert response.status_code == 502
    assert response.json()["detail"] == "Invalid response from Bedrock"
