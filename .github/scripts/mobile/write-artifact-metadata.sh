#!/usr/bin/env bash
set -euo pipefail

# SCRUM-348. Writes the artifact-metadata contract (specs/035-mobile-security-test-artifacts/
# contracts/artifact-metadata.md) shared by mobile-native-build.yml's android-build and
# ios-build jobs, so the schema is defined once instead of duplicated per platform.
#
# Usage: write-artifact-metadata.sh <metadata-json-path> <step-summary-path>
# Required env: PLATFORM ARTIFACT_TYPE BUILD_PROFILE APP_VERSION COMMIT_SHA RUN_ID RUN_URL
#               TRIGGERED_BY

usage() {
  echo "usage: $(basename "$0") <metadata-json-path> <step-summary-path>" >&2
}

if [[ $# -ne 2 ]]; then
  usage
  exit 1
fi

metadata_path="$1"
summary_path="$2"

required_vars=(PLATFORM ARTIFACT_TYPE BUILD_PROFILE APP_VERSION COMMIT_SHA RUN_ID RUN_URL TRIGGERED_BY)
for var in "${required_vars[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    echo "write-artifact-metadata.sh: required environment variable '$var' is missing or empty" >&2
    exit 1
  fi
done

mkdir -p "$(dirname "$metadata_path")"
mkdir -p "$(dirname "$summary_path")"

cat >"$metadata_path" <<JSON
{
  "platform": "$PLATFORM",
  "artifact_type": "$ARTIFACT_TYPE",
  "build_profile": "$BUILD_PROFILE",
  "app_version": "$APP_VERSION",
  "commit_sha": "$COMMIT_SHA",
  "run_id": "$RUN_ID",
  "run_url": "$RUN_URL",
  "triggered_by": "$TRIGGERED_BY"
}
JSON

{
  echo "## Mobile Native Build — $PLATFORM ($ARTIFACT_TYPE)"
  echo
  echo "| Field | Value |"
  echo "| --- | --- |"
  echo "| platform | \`$PLATFORM\` |"
  echo "| artifact_type | \`$ARTIFACT_TYPE\` |"
  echo "| build_profile | \`$BUILD_PROFILE\` |"
  echo "| app_version | \`$APP_VERSION\` |"
  echo "| commit_sha | \`$COMMIT_SHA\` |"
  echo "| run_id | \`$RUN_ID\` |"
  echo "| run_url | $RUN_URL |"
  echo "| triggered_by | \`$TRIGGERED_BY\` |"
  echo
} >>"$summary_path"
