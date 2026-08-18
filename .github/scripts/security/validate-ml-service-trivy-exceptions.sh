#!/usr/bin/env bash
# Compatibility entry point retained for existing ML-service callers.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/validate-trivy-exceptions.sh" "$@"
