#!/usr/bin/env bash
set -euo pipefail

# SCRUM-350. The fail-closed iOS analyzer-availability check (FR-003/FR-004, research.md R5).
# Mirrors mobile-native-build.yml's "Check Apple ad-hoc signing material" step exactly: check
# for a usable environment, and if none is usable, fail closed with a clear message before
# any artifact-install/MobSF/Maestro step ever runs.
#
# Two independent paths, checked in this order:
#   1. Corellium -- reachable from any runner. Presence-only check: MOBSF_CORELLIUM_API_DOMAIN
#      and MOBSF_CORELLIUM_API_KEY must both be set (these are MobSF's own env var names,
#      verified against mobsf/MobSF/settings.py -- MobSF's own Corellium integration reads
#      exactly these three names, MOBSF_CORELLIUM_PROJECT_ID being optional). This script
#      deliberately does NOT independently validate the token against Corellium's own API:
#      Corellium's raw API is not open source and this project has no verified reference for
#      its auth endpoint shape, whereas MobSF's REST API is fully verified from source. Real
#      credential validation happens naturally at the first live MobSF Corellium call
#      (`/api/v1/ios/corellium_create_ios_instance`) later in the job -- that call failing
#      (e.g. a lapsed Corellium Solo trial) must fail the job there, not report a false pass
#      here.
#   2. Physical signed device -- only reachable when this job is actually running on the
#      self-hosted runner it is attached to (via the workflow's `ios_runner_label` dispatch
#      input, contracts/mobsf-dynamic-scan-dispatch.md). IOS_DEVICE_UDID must be set AND
#      `idevice_id -l` must list that UDID as currently connected. This is also the value
#      passed as MobSF's own `device_id` API parameter later (mobsf/DynamicAnalyzer/views/
#      ios/device/dynamic_analyzer.py's IOS_DEVICE_ID_REGEX matches a USB UDID directly) --
#      note MobSF's iOS device dynamic analysis requires a **jailbroken** device with SSH
#      access (its own module docstring: "iOS Jailbroken Device"), not merely a signed one.
#
# Usage: check-ios-analyzer-availability.sh <output-env-file>
# On success, writes analyzer_environment=ios-corellium|ios-signed-device to
# <output-env-file> and exits 0. On failure, writes nothing and exits non-zero.

usage() {
  echo "usage: $(basename "$0") <output-env-file>" >&2
}

fail_not_provisioned() {
  echo "check-ios-analyzer-availability.sh: iOS dynamic analyzer environment is not provisioned (checked Corellium and a physical device; neither is usable). See docs/runbooks/SCRUM-350-mobsf-dynamic-scanning.md." >&2
  exit 1
}

if [[ $# -ne 1 ]]; then
  usage
  exit 1
fi

output_env_path="$1"

try_corellium() {
  [[ -n "${MOBSF_CORELLIUM_API_DOMAIN:-}" && -n "${MOBSF_CORELLIUM_API_KEY:-}" ]] || return 1
  echo "analyzer_environment=ios-corellium" >"$output_env_path"
  return 0
}

try_physical_device() {
  [[ -n "${IOS_DEVICE_UDID:-}" ]] || return 1
  command -v idevice_id >/dev/null 2>&1 || return 1

  if ! idevice_id -l 2>/dev/null | grep -qF -- "$IOS_DEVICE_UDID"; then
    return 1
  fi

  echo "analyzer_environment=ios-signed-device" >"$output_env_path"
  return 0
}

if try_corellium; then
  exit 0
fi

if try_physical_device; then
  exit 0
fi

fail_not_provisioned
