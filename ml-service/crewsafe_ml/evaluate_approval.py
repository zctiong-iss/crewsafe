"""Command-line entry point for untouched-period model approval evidence."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Sequence

from .approval_evaluation import (
    DEFAULT_MINIMUM_UNTOUCHED_DAYS,
    evaluate_frozen_candidate,
)
from .safe_paths import configured_workspace_root, confined_output_path, write_json_atomically


def main(arguments: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Evaluate a frozen WBGT candidate on newer untouched data."
    )
    parser.add_argument("--model-manifest", required=True, type=Path)
    parser.add_argument("--model-manifest-sha256", required=True)
    parser.add_argument("--features", required=True, type=Path)
    parser.add_argument("--feature-manifest", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--minimum-untouched-days",
        type=int,
        default=DEFAULT_MINIMUM_UNTOUCHED_DAYS,
    )
    options = parser.parse_args(arguments)
    workspace_root = configured_workspace_root()
    output_path = confined_output_path(
        options.output,
        workspace_root,
        label="approval evaluation report",
    )
    if output_path.exists():
        raise ValueError("approval evaluation report already exists")

    report = evaluate_frozen_candidate(
        model_manifest_path=options.model_manifest,
        expected_model_manifest_sha256=options.model_manifest_sha256,
        feature_path=options.features,
        feature_manifest_path=options.feature_manifest,
        workspace_root=workspace_root,
        minimum_untouched_days=options.minimum_untouched_days,
    )
    write_json_atomically(
        output_path,
        report,
        workspace_root,
        label="approval evaluation report",
    )
    print(f"Approval report: {output_path}")
    print(f"Decision: {report['decision']}")
    for horizon, result in report["horizons"].items():
        print(
            f"{horizon}m MAE: persistence {result['persistence']['mae']:.4f} -> "
            f"candidate {result['candidate']['mae']:.4f}; "
            f"safety rule passed: {result['passes_safety_rule']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
