"""Regression checks for the ML service's security configuration."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DOCKERFILE = ROOT / "ml-service/Dockerfile"
RUNTIME_REQUIREMENTS = ROOT / "ml-service/requirements-runtime.txt"
STAGING_BUNDLE = "model-bundle/staging-demo-v1"


def test_runtime_dependencies_are_hash_locked() -> None:
    requirements = RUNTIME_REQUIREMENTS.read_text(encoding="utf-8")

    assert "--hash=sha256:" in requirements


def test_container_installs_locked_runtime_dependencies_as_non_root() -> None:
    dockerfile = DOCKERFILE.read_text(encoding="utf-8")

    assert "pip install --no-cache-dir --require-hashes --only-binary :all:" in dockerfile
    assert "requirements-runtime.txt" in dockerfile
    assert "USER appuser" in dockerfile


def test_container_applies_available_os_security_updates_before_dependencies() -> None:
    """Supported base-image package fixes must be applied before the scan gate."""

    dockerfile = DOCKERFILE.read_text(encoding="utf-8")

    assert "apt-get update" in dockerfile
    assert "apt-get upgrade -y --no-install-recommends" in dockerfile
    assert "rm -rf /var/lib/apt/lists/*" in dockerfile


def test_container_bakes_the_staging_bundle_as_read_only() -> None:
    """The deployed image must contain, but cannot modify, the reviewed bundle."""

    dockerfile = DOCKERFILE.read_text(encoding="utf-8")

    assert f"COPY {STAGING_BUNDLE} ./{STAGING_BUNDLE}" in dockerfile
    assert "chmod -R a-w crewsafe_ml agent model-bundle" in dockerfile
