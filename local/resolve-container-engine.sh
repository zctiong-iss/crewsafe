#!/usr/bin/env bash
set -euo pipefail

container_engine="${CREWSAFE_CONTAINER_ENGINE:-podman}"
case "$container_engine" in
  docker|podman) printf '%s\n' "$container_engine" ;;
  *)
    echo "Container engine must be docker or podman." >&2
    exit 1
    ;;
esac