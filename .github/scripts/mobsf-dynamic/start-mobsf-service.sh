#!/usr/bin/env bash
set -euo pipefail

# SCRUM-350. Starts MobSF as an ephemeral, per-job service container (research.md R6) and
# waits for it to become ready, bounded within a timeout that contributes to FR-004's overall
# 10-minute analyzer-availability window. A generated REST API key is passed to the container
# at start and written only to the output env file -- never to stdout/stderr (FR-006, SEC-003).
#
# Runs with `--network host` (verified against MobSF's own source,
# github.com/MobSF/Mobile-Security-Framework-MobSF: mobsf.MobSF.utils.get_device() shells out
# to `adb devices`, and android/dynamic_analyzer.py's install/mobsfy path needs that same ADB
# server) -- the Android emulator this feature boots (reactivecircus/android-emulator-runner)
# runs directly on the GitHub Actions runner, not in a container, so MobSF's own container
# needs the host's network namespace to reach the host's ADB server at all. In host network
# mode there is no `-p` port mapping: the container listens on the host's port 8000 directly.
#
# Required env: MOBSF_IMAGE (pinned by digest, e.g.
#   opensecurity/mobile-security-framework-mobsf@sha256:<64-hex>)
# Optional env, passed through to the container verbatim when set (research.md R5/R6):
#   ANALYZER_IDENTIFIER   -- the ADB device MobSF should target (e.g. emulator-5554);
#                            without it MobSF falls back to auto-detecting via `adb devices`,
#                            which is ambiguous if more than one device is ever visible.
#   MOBSF_CORELLIUM_API_DOMAIN / MOBSF_CORELLIUM_API_KEY / MOBSF_CORELLIUM_PROJECT_ID --
#                            MobSF's own Corellium integration reads exactly these three
#                            env var names (mobsf/MobSF/settings.py); this workflow never
#                            calls Corellium's API directly, only MobSF's own
#                            /api/v1/ios/corellium_* endpoints, which need these set on the
#                            MobSF container itself.
# Optional env: MOBSF_START_TIMEOUT_SECONDS (default 300), MOBSF_START_POLL_INTERVAL_SECONDS
#   (default 5)
#
# Usage: start-mobsf-service.sh <output-env-file>
# On success, writes MOBSF_API_KEY, MOBSF_CONTAINER_ID, and MOBSF_BASE_URL to
# <output-env-file> (a $GITHUB_ENV-style KEY=VALUE file) and exits 0.
# On any failure, writes nothing to <output-env-file> and exits non-zero.

usage() {
  echo "usage: $(basename "$0") <output-env-file>" >&2
}

fail() {
  echo "start-mobsf-service.sh: $1" >&2
  [[ -n "${container_id:-}" ]] && docker rm -f "$container_id" >/dev/null 2>&1 || true
  exit 1
}

if [[ $# -ne 1 ]]; then
  usage
  exit 1
fi

output_env_path="$1"

[[ -n "${MOBSF_IMAGE:-}" ]] || { echo "start-mobsf-service.sh: required env var MOBSF_IMAGE is not set" >&2; exit 1; }

timeout_seconds="${MOBSF_START_TIMEOUT_SECONDS:-300}"
poll_interval_seconds="${MOBSF_START_POLL_INTERVAL_SECONDS:-5}"

# 64-char lowercase-hex, generated fresh for this run -- never reused across runs, never
# echoed anywhere but the output env file. MOBSF_API_KEY is the exact env var name MobSF's
# own mobsf.MobSF.init.api_key() reads to fix the API key instead of auto-generating one.
mobsf_api_key="$(head -c 64 /dev/urandom | sha256sum | awk '{print $1}')"

docker_env_args=(-e "MOBSF_API_KEY=${mobsf_api_key}")
for passthrough_var in ANALYZER_IDENTIFIER MOBSF_CORELLIUM_API_DOMAIN MOBSF_CORELLIUM_API_KEY MOBSF_CORELLIUM_PROJECT_ID; do
  if [[ -n "${!passthrough_var:-}" ]]; then
    docker_env_args+=(-e "${passthrough_var}=${!passthrough_var}")
  fi
done

container_id="$(docker run -d --rm --network host "${docker_env_args[@]}" "$MOBSF_IMAGE" 2>&1)" \
  || fail "container failed to start (docker run exited non-zero)"

# Poll the same root-path check MobSF's own official Dockerfile defines as its HEALTHCHECK
# (`curl --fail http://host.docker.internal:8000/`) -- reachable directly at localhost:8000
# from the runner because of --network host above. The production image runs gunicorn
# (scripts/entrypoint.sh: `gunicorn -b 0.0.0.0:8000 ... --log-level=citical`), not Django's
# `runserver`, so there is no dev-server startup line to grep for; polling the actual HTTP
# port is what the image's own maintainers consider the correct readiness signal.
elapsed=0
ready=0
while [[ "$elapsed" -lt "$timeout_seconds" ]]; do
  if curl -fsS -o /dev/null "http://localhost:8000/" 2>/dev/null; then
    ready=1
    break
  fi
  sleep "$poll_interval_seconds"
  elapsed=$((elapsed + poll_interval_seconds))
done

if [[ "$ready" -ne 1 ]]; then
  fail "MobSF API did not become ready within ${timeout_seconds}s (FR-004)"
fi

{
  echo "MOBSF_API_KEY=${mobsf_api_key}"
  echo "MOBSF_CONTAINER_ID=${container_id}"
  echo "MOBSF_BASE_URL=http://localhost:8000"
} >"$output_env_path"
