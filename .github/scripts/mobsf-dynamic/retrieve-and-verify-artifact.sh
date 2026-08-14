#!/usr/bin/env bash
set -euo pipefail

# SCRUM-350. Verifies and hashes a build artifact already downloaded (by the caller, via
# actions/download-artifact) from a mobile-native-build.yml run. The commit SHA is always
# read from that source run's own artifact-metadata.json (SCRUM-348 contract) -- it is never
# accepted as a separate argument, so a caller cannot claim provenance the artifact itself
# doesn't back up (SEC-002, contracts/mobsf-dynamic-scan-dispatch.md).
#
# Usage: retrieve-and-verify-artifact.sh <artifact-dir>
# <artifact-dir> must contain exactly one artifact-metadata.json (SCRUM-348 shape) and
# exactly one other entry (the binary file or directory bundle to verify/hash).
#
# Emits (stdout, and $GITHUB_OUTPUT if set):
#   commit_sha=<40-char lowercase hex>
#   artifact_sha256=<64-char lowercase hex>
#   artifact_path=<absolute path to the verified artifact entry>

usage() {
  echo "usage: $(basename "$0") <artifact-dir>" >&2
}

fail() {
  echo "retrieve-and-verify-artifact.sh: $1" >&2
  exit 1
}

if [[ $# -ne 1 ]]; then
  usage
  exit 1
fi

artifact_dir="$1"

[[ -d "$artifact_dir" ]] || fail "artifact directory not found: $artifact_dir"

metadata_path="$artifact_dir/artifact-metadata.json"
[[ -r "$metadata_path" ]] || fail "source artifact-metadata.json not found at $metadata_path -- cannot verify provenance (SEC-002)"

jq -e . "$metadata_path" >/dev/null 2>&1 || fail "source artifact-metadata.json is not valid JSON: $metadata_path"

commit_sha="$(jq -r '.commit_sha // empty' "$metadata_path")"
[[ -n "$commit_sha" ]] || fail "source artifact-metadata.json has no commit_sha field: $metadata_path"
if [[ ! "$commit_sha" =~ ^[0-9a-f]{40}$ ]]; then
  fail "commit_sha in source metadata is not a 40-character lowercase hex string: $commit_sha"
fi

# The artifact itself is whatever else sits alongside the metadata file -- exactly one entry
# is expected (matches every SCRUM-348 upload shape: a single .apk/.aab, or a single .app /
# export directory, next to artifact-metadata.json).
entry_count=0
artifact_path=""
while IFS= read -r -d '' entry; do
  entry_count=$((entry_count + 1))
  artifact_path="$entry"
done < <(find "$artifact_dir" -mindepth 1 -maxdepth 1 -not -name 'artifact-metadata.json' -print0)

if [[ "$entry_count" -ne 1 ]]; then
  fail "expected exactly one artifact entry alongside artifact-metadata.json in $artifact_dir, found $entry_count"
fi

if [[ -f "$artifact_path" ]]; then
  artifact_sha256="$(sha256sum "$artifact_path" | awk '{print $1}')"
elif [[ -d "$artifact_path" ]]; then
  # Directory bundle (e.g. an iOS .app): hash the sorted, path-relative per-file digests so
  # the result depends only on content, never on the absolute temp path it was extracted to.
  artifact_sha256="$(
    find "$artifact_path" -type f -print0 \
      | sort -z \
      | while IFS= read -r -d '' f; do
          rel="${f#"$artifact_path"/}"
          printf '%s  %s\n' "$(sha256sum "$f" | awk '{print $1}')" "$rel"
        done \
      | sha256sum | awk '{print $1}'
  )"
else
  fail "artifact entry is neither a file nor a directory: $artifact_path"
fi

echo "commit_sha=$commit_sha"
echo "artifact_sha256=$artifact_sha256"
echo "artifact_path=$artifact_path"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "commit_sha=$commit_sha"
    echo "artifact_sha256=$artifact_sha256"
    echo "artifact_path=$artifact_path"
  } >>"$GITHUB_OUTPUT"
fi
