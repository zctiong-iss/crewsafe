#!/usr/bin/env bash
set -euo pipefail
printf 'curl\n' >>"${MOCK_CALL_LOG:?}"
printf 'curl_url=%s\n' "${*: -1}" >>"${MOCK_CALL_LOG:?}"
if [[ "$*" == *"resolutions=FIXED"* && -n "${MOCK_CURL_LIFECYCLE_RESPONSE_FILE:-}" ]]; then
  cat "$MOCK_CURL_LIFECYCLE_RESPONSE_FILE"
  exit 0
fi
cat "${MOCK_CURL_RESPONSE_FILE:?}"
