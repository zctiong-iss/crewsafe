"""CLI for local or SageMaker-compatible WBGT training."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import Sequence

from .safe_paths import configured_workspace_root
from .training import train_and_package


def main(arguments: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Train and package WBGT forecasts.")
    parser.add_argument("--dataset", required=True, type=Path)
    parser.add_argument("--dataset-manifest", required=True, type=Path)
    parser.add_argument(
        "--output-directory",
        type=Path,
        default=Path(os.getenv("SM_MODEL_DIR", "artifacts")),
    )
    parser.add_argument("--model-version")
    parser.add_argument("--source-commit")
    options = parser.parse_args(arguments)
    workspace_root = configured_workspace_root()

    manifest = train_and_package(
        dataset_path=options.dataset,
        dataset_manifest_path=options.dataset_manifest,
        output_directory=options.output_directory,
        model_version=options.model_version,
        source_commit=options.source_commit,
        workspace_root=workspace_root,
    )
    print(f"Model manifest: {manifest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
