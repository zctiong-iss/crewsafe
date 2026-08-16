"""The developer runner must not publish ml-service to every network interface (SCRUM-401).

SonarQube flagged `python:S8392` on `app.py`'s `if __name__ == "__main__"` block, which bound
`0.0.0.0`. That block is the `python app.py` convenience documented in README.md, run on a
developer's own machine by a caller on that same machine — so all-interfaces bought nothing and
exposed the service to whatever network the laptop happened to be on.

These tests pin the safe default and the deliberate escape hatch. They deliberately do NOT
assert anything about the container, whose `CMD` binds `0.0.0.0` on purpose: Docker port
publishing only reaches a process bound to all interfaces, and the container is isolated by its
own network boundary instead (in ECS, by having no ALB or security-group ingress at all).
"""
import importlib
import os
import sys
from unittest import mock

import pytest


@pytest.fixture(name="dev_server_bind")
def _dev_server_bind():
    """Import app lazily: importing it at module scope builds the ForecastService registry."""
    if "app" in sys.modules:
        return importlib.import_module("app").dev_server_bind
    return importlib.import_module("app").dev_server_bind


def test_defaults_to_loopback(dev_server_bind):
    with mock.patch.dict(os.environ, {}, clear=False):
        os.environ.pop("ML_SERVICE_HOST", None)
        host, _ = dev_server_bind()

    assert host == "127.0.0.1", (
        "the developer runner must default to loopback; 0.0.0.0 exposes a laptop's "
        "ml-service to every network it is attached to (SCRUM-401)"
    )


def test_never_defaults_to_all_interfaces(dev_server_bind):
    """The specific regression: a well-meaning revert to 0.0.0.0 must fail this suite."""
    with mock.patch.dict(os.environ, {}, clear=False):
        os.environ.pop("ML_SERVICE_HOST", None)
        host, _ = dev_server_bind()

    assert host not in {"0.0.0.0", "::", ""}


def test_default_port_is_unchanged(dev_server_bind):
    with mock.patch.dict(os.environ, {}, clear=False):
        os.environ.pop("ML_SERVICE_PORT", None)
        _, port = dev_server_bind()

    assert port == 8000


def test_host_override_is_honoured(dev_server_bind):
    """Docker Compose reaching the host via host.docker.internal needs a non-loopback bind."""
    with mock.patch.dict(os.environ, {"ML_SERVICE_HOST": "0.0.0.0"}):
        host, _ = dev_server_bind()

    assert host == "0.0.0.0"


def test_port_override_is_honoured(dev_server_bind):
    with mock.patch.dict(os.environ, {"ML_SERVICE_PORT": "9100"}):
        _, port = dev_server_bind()

    assert port == 9100
