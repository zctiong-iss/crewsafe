"""Regression checks for the ML service's security configuration."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DOCKERFILE = ROOT / "ml-service/Dockerfile"
RUNTIME_REQUIREMENTS = ROOT / "ml-service/requirements-runtime.txt"


def test_runtime_dependencies_are_hash_locked() -> None:
    requirements = RUNTIME_REQUIREMENTS.read_text(encoding="utf-8")

    assert "--hash=sha256:" in requirements


def test_container_installs_locked_runtime_dependencies_as_non_root() -> None:
    dockerfile = DOCKERFILE.read_text(encoding="utf-8")

    assert "pip install --no-cache-dir --require-hashes --only-binary :all:" in dockerfile
    assert "requirements-runtime.txt" in dockerfile
    assert "USER appuser" in dockerfile
