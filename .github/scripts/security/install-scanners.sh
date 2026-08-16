#!/usr/bin/env bash
# Install the pinned security scanners used by .github/workflows/security-scan.yml.
#
# Downloads are verified against a pinned SHA-256 checksum before anything is
# executed. An unverified download inside a security gate would be a supply-chain
# hole in the one place least able to afford one.
#
# Exit codes (see specs contract: contracts/workflow-checks.md)
#   0  scanner installed and version-verified
#   2  any failure -- download, checksum mismatch, version mismatch, bad usage
#
# Note there is no exit code 1 here: this script never reports findings, so
# "failed to install" is always an infrastructure failure and must fail closed.
set -euo pipefail

GITLEAKS_VERSION="8.30.1"
# linux_x64 tarball checksum from the upstream release checksums.txt.
GITLEAKS_SHA256_LINUX_X64="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
# darwin_arm64 tarball checksum, for local developer installs.
GITLEAKS_SHA256_DARWIN_ARM64="b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5"

readonly EXIT_ERROR=2

log() { printf '%s\n' "$*" >&2; }

die() {
  log "ERROR: $*"
  exit "$EXIT_ERROR"
}

install_dir="${1:-/usr/local/bin}"

require_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || die "required command not found: $cmd"
}

# Linux runners ship sha256sum; macOS ships shasum. Support both so the same
# script verifies downloads in CI and on a developer workstation.
sha256_of() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | cut -d' ' -f1
  else
    die "no SHA-256 tool found (need sha256sum or shasum)"
  fi
}

install_gitleaks() {
  local os arch asset url tmp
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"

  local expected
  case "$os/$arch" in
    linux/x86_64)
      asset="gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
      expected="$GITLEAKS_SHA256_LINUX_X64"
      ;;
    darwin/arm64)
      asset="gitleaks_${GITLEAKS_VERSION}_darwin_arm64.tar.gz"
      expected="$GITLEAKS_SHA256_DARWIN_ARM64"
      ;;
    *)
      die "unsupported platform: $os/$arch. CI runs on linux/x86_64; install gitleaks ${GITLEAKS_VERSION} manually for local use (see specs quickstart.md)"
      ;;
  esac

  url="https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${asset}"

  tmp="$(mktemp -d)"
  # shellcheck disable=SC2064 # expand tmp now, not at trap time
  trap "rm -rf '$tmp'" EXIT

  log "Downloading gitleaks ${GITLEAKS_VERSION}"
  curl --proto "=https" --fail --silent --show-error --location --retry 3 --retry-delay 2 \
    --output "$tmp/$asset" "$url" || die "download failed: $url"

  log "Verifying SHA-256 checksum"
  local actual
  actual="$(sha256_of "$tmp/$asset")"
  if [[ "$actual" != "$expected" ]]; then
    die "checksum mismatch for ${asset}: expected ${expected}, got ${actual}"
  fi

  tar -xzf "$tmp/$asset" -C "$tmp" gitleaks || die "failed to extract gitleaks from ${asset}"
  install -m 0755 "$tmp/gitleaks" "$install_dir/gitleaks" || die "failed to install gitleaks to $install_dir"

  # Confirm the binary we just installed is the version we pinned. Guards against
  # a stale binary earlier on PATH shadowing the intended one.
  local reported
  reported="$(gitleaks version 2>/dev/null || true)"
  [[ "$reported" == *"$GITLEAKS_VERSION"* ]] ||
    die "gitleaks version mismatch after install: expected ${GITLEAKS_VERSION}, got '${reported:-<none>}'"

  log "gitleaks ${GITLEAKS_VERSION} installed"
}

main() {
  require_cmd curl
  require_cmd tar
  install_gitleaks
}

main "$@"
