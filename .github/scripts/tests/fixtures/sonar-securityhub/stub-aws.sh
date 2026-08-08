#!/usr/bin/env bash
set -euo pipefail
service="${1:-}"
operation="${2:-}"
printf '%s %s\n' "$service" "$operation" >>"${MOCK_CALL_LOG:?}"
case "$service $operation" in
  "sts get-caller-identity") printf '%s\n' "${MOCK_AWS_ACCOUNT_ID:-123456789012}" ;;
  "securityhub get-findings") cat "${MOCK_AWS_FINDINGS_RESPONSE_FILE:?}" ;;
  "securityhub batch-import-findings") cat "${MOCK_AWS_IMPORT_RESPONSE_FILE:?}" ;;
  *) exit 64 ;;
esac
