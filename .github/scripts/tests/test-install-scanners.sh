#!/usr/bin/env bash
# SCRUM-419 (shell:S6506): the gitleaks download in install-scanners.sh follows
# redirects (--location) and must pin the protocol to HTTPS across every hop,
# so a redirect cannot silently downgrade the transport to plaintext HTTP.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/.github/scripts/security/install-scanners.sh"

[[ -f "$SCRIPT" ]] || { echo "FAIL: missing $SCRIPT" >&2; exit 1; }

rg -q -F -- '--proto "=https"' "$SCRIPT" || {
  echo "FAIL: expected '--proto \"=https\"' on the gitleaks download curl call in $SCRIPT" >&2
  exit 1
}

echo "test-install-scanners.sh: all assertions passed"
