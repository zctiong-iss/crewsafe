"""Filesystem boundaries for offline ML commands.

Training utilities accept paths from command-line arguments, so every path is
resolved and checked against one trusted workspace before it is used.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any, Mapping


def configured_workspace_root() -> Path:
    """Return the trusted root for local or SageMaker training files."""

    # SageMaker reserves /opt/ml for input channels, model output, and job data.
    # Trust that fixed boundary only when SageMaker exposes its model folder.
    model_directory = os.getenv("SM_MODEL_DIR")
    if model_directory:
        sage_maker_root = Path("/opt/ml")
        resolved_model_directory = Path(model_directory).resolve(strict=False)
        if resolved_model_directory.is_relative_to(sage_maker_root):
            return sage_maker_root

    return Path.cwd().resolve(strict=True)


def confined_existing_file(path: Path, workspace_root: Path, *, label: str) -> Path:
    """Resolve an existing regular file contained by the trusted workspace."""

    resolved = _confined_path(path, workspace_root, label=label, strict=True)
    if not resolved.is_file():
        raise ValueError(f"{label} must be a regular file")
    return resolved


def confined_output_path(path: Path, workspace_root: Path, *, label: str) -> Path:
    """Resolve a new file or directory path contained by the workspace."""

    return _confined_path(path, workspace_root, label=label, strict=False)


def sha256_file(path: Path, workspace_root: Path, *, label: str) -> str:
    """Hash only a verified file inside the trusted workspace."""

    safe_path = confined_existing_file(path, workspace_root, label=label)
    digest = hashlib.sha256()
    with safe_path.open("rb") as source:
        for chunk in iter(lambda: source.read(64 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json_object(
    path: Path,
    workspace_root: Path,
    *,
    label: str,
) -> Mapping[str, Any]:
    """Read a JSON object only after confining its file to the workspace."""

    safe_path = confined_existing_file(path, workspace_root, label=label)
    try:
        payload = json.loads(safe_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"{label} is unreadable") from error
    if not isinstance(payload, Mapping):
        raise ValueError(f"{label} must contain a JSON object")
    return payload


def write_json_atomically(
    path: Path,
    payload: dict[str, Any],
    workspace_root: Path,
    *,
    label: str,
) -> None:
    """Replace a JSON file atomically without escaping the trusted workspace."""

    safe_path = confined_output_path(path, workspace_root, label=label)
    safe_path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        dir=safe_path.parent,
        prefix=f".{safe_path.name}.",
        suffix=".tmp",
        text=True,
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as destination:
            destination.write(json.dumps(payload, indent=2, sort_keys=True) + "\n")
        os.replace(temporary_path, safe_path)
    finally:
        temporary_path.unlink(missing_ok=True)


def _confined_path(
    path: Path,
    workspace_root: Path,
    *,
    label: str,
    strict: bool,
) -> Path:
    root = workspace_root.expanduser().resolve(strict=True)
    candidate = path.expanduser()
    if not candidate.is_absolute():
        candidate = root / candidate
    resolved = candidate.resolve(strict=strict)
    if not resolved.is_relative_to(root):
        raise ValueError(f"{label} must stay inside the ML workspace")
    return resolved
