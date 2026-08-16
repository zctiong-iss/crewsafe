#!/usr/bin/env bash
# SCRUM-419 (githubactions:S6505): security-scan.yml's own web- and mobile-
# dependency installs (used to generate coverage for SonarQube) must disable
# lifecycle-script execution, same as every other npm ci call site in this repo.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/security-scan.yml"

install_count="$(rg -c -F -- 'npm ci --ignore-scripts' "$WORKFLOW" || true)"
if [[ "${install_count:-0}" -lt 2 ]]; then
  echo "FAIL: expected >=2 'npm ci --ignore-scripts' occurrences (web + mobile coverage installs) in $WORKFLOW, found ${install_count:-0}" >&2
  exit 1
fi

echo "test-security-scan-dependency-install.sh: all assertions passed"
