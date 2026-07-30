#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

CREWSAFE_CONTAINER_ENGINE=docker exec ./run.sh "$@"
