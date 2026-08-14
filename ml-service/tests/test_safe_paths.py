"""Security tests for offline ML filesystem boundaries."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from crewsafe_ml.safe_paths import (
    confined_existing_file,
    confined_output_path,
    read_json_object,
    write_json_atomically,
)


class SafePathTest(unittest.TestCase):
    def test_accepts_input_and_output_inside_the_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            workspace = Path(temporary_directory)
            source = workspace / "data" / "manifest.json"
            source.parent.mkdir()
            source.write_text('{"status":"ok"}\n', encoding="utf-8")

            safe_source = confined_existing_file(source, workspace, label="input")
            safe_output = confined_output_path(
                Path("artifacts/result.json"),
                workspace,
                label="output",
            )

            self.assertEqual(source, safe_source)
            self.assertEqual(workspace / "artifacts" / "result.json", safe_output)

    def test_rejects_an_input_outside_the_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            parent = Path(temporary_directory)
            workspace = parent / "workspace"
            workspace.mkdir()
            outside = parent / "outside.json"
            outside.write_text("{}\n", encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "inside the ML workspace"):
                confined_existing_file(outside, workspace, label="input")

    def test_rejects_an_output_outside_the_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            workspace = Path(temporary_directory) / "workspace"
            workspace.mkdir()

            with self.assertRaisesRegex(ValueError, "inside the ML workspace"):
                confined_output_path(Path("../escape.json"), workspace, label="output")

    def test_rejects_a_symlink_that_escapes_the_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            parent = Path(temporary_directory)
            workspace = parent / "workspace"
            workspace.mkdir()
            outside = parent / "outside.json"
            outside.write_text("{}\n", encoding="utf-8")
            (workspace / "linked.json").symlink_to(outside)

            with self.assertRaisesRegex(ValueError, "inside the ML workspace"):
                confined_existing_file(workspace / "linked.json", workspace, label="input")

    def test_reads_and_atomically_writes_json_inside_the_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            workspace = Path(temporary_directory)
            output = workspace / "reports" / "result.json"

            write_json_atomically(output, {"status": "ok"}, workspace, label="report")
            payload = read_json_object(output, workspace, label="report")

            self.assertEqual({"status": "ok"}, payload)
            self.assertEqual({"status": "ok"}, json.loads(output.read_text(encoding="utf-8")))


if __name__ == "__main__":
    unittest.main()
