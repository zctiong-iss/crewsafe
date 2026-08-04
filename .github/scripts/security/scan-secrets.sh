#!/usr/bin/env bash
# Secret-scanning gate for WBGT CrewSafe SG (SCRUM-178, FR-002 / FR-002a / FR-007).
#
# Runs gitleaks over a defined commit scope and writes a normalized, REDACTED
# findings file for report-findings.sh to render.
#
# Usage
#   scan-secrets.sh --mode range --base <ref> [--out <path>]
#   scan-secrets.sh --mode full            [--out <path>]
#
# Exit codes
#   0  gitleaks ran; no findings in scope
#   1  gitleaks ran; one or more findings (every secret finding blocks -- FR-007)
#   2  gitleaks could not run: missing binary, unresolvable merge-base, malformed
#      report, bad arguments
#
# The 1-vs-2 split is the whole of fail-closed. A reviewer must be able to tell
# "we found something" from "we could not look", and both must block the merge.
#
# REDACTION (FR-010): the raw gitleaks report contains the credential itself in
# its Secret and Match fields -- verified against gitleaks 8.30.1. This script
# never prints the raw report, never copies it outside the ephemeral work
# directory, and projects only RuleID/File/StartLine/Commit into its output. A
# naive `cat report.json` would turn a leak detector into a leak publisher.
set -euo pipefail

readonly EXIT_CLEAN=0
readonly EXIT_FINDINGS=1
readonly EXIT_ERROR=2

log() { printf '%s\n' "$*" >&2; }

die() {
  log "ERROR: $*"
  exit "$EXIT_ERROR"
}

usage() {
  cat >&2 <<'EOF'
usage: scan-secrets.sh --mode range --base <ref> [--out <path>]
       scan-secrets.sh --mode full [--out <path>]
EOF
  exit "$EXIT_ERROR"
}

mode=""
base=""
out=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      [[ $# -ge 2 ]] || die "--mode requires a value"
      mode="$2"
      shift 2
      ;;
    --base)
      [[ $# -ge 2 ]] || die "--base requires a value"
      base="$2"
      shift 2
      ;;
    --out)
      [[ $# -ge 2 ]] || die "--out requires a value"
      out="$2"
      shift 2
      ;;
    -h | --help) usage ;;
    *) die "unknown argument: $1" ;;
  esac
done

case "$mode" in
  range)
    [[ -n "$base" ]] || die "--mode range requires --base"
    ;;
  full)
    [[ -z "$base" ]] || die "--base is not valid with --mode full"
    ;;
  "") die "--mode is required (range|full)" ;;
  *) die "unknown mode: $mode (expected range|full)" ;;
esac

command -v gitleaks >/dev/null 2>&1 ||
  die "gitleaks not found on PATH. Install with .github/scripts/security/install-scanners.sh"
command -v jq >/dev/null 2>&1 || die "jq not found on PATH"
git rev-parse --git-dir >/dev/null 2>&1 || die "not inside a git repository"

# The raw report lives in an ephemeral directory removed on exit, on success and
# on failure alike. It holds credential material.
work="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/secret-scan.XXXXXX")" ||
  die "could not create a temporary directory"
# shellcheck disable=SC2064 # expand work now, not at trap time
trap "rm -rf '$work'" EXIT INT TERM

raw="$work/gitleaks-report.json"
[[ -n "$out" ]] || out="$work/normalized-findings.json"

config_args=()
repo_config="$(git rev-parse --show-toplevel)/.gitleaks.toml"
[[ -f "$repo_config" ]] && config_args+=(--config "$repo_config")

# --exit-code 0 makes gitleaks report findings without deciding the outcome.
# This script owns the exit contract, so the findings-vs-error distinction
# cannot be lost in translation.
scan_args=(git --no-banner --exit-code 0 --report-format json --report-path "$raw")

if [[ "$mode" == "range" ]]; then
  # Recompute the merge-base from live refs on EVERY run. A cached value, or
  # github.event.pull_request.base.sha, can point outside the current history
  # after a rebase or force-push, silently shrinking the scanned range.
  merge_base="$(git merge-base "$base" HEAD 2>/dev/null)" ||
    die "could not resolve merge-base of '$base' and HEAD (shallow clone? use fetch-depth: 0)"
  [[ -n "$merge_base" ]] || die "empty merge-base for '$base'"
  scope="${merge_base}..HEAD"
  commit_count="$(git rev-list --count "$scope" 2>/dev/null || echo '?')"
  log "Scanning commit range ${scope} (${commit_count} commit(s))"
  scan_args+=(--log-opts "$scope")
else
  scope="full history"
  log "Scanning full repository history"
fi

if ! gitleaks "${scan_args[@]}" ${config_args[@]+"${config_args[@]}"} >&2; then
  die "gitleaks failed to run (scope: ${scope})"
fi

[[ -f "$raw" ]] || die "gitleaks produced no report (scope: ${scope})"

# Project ONLY the allowed fields. Secret, Match, and any surrounding-line field
# are dropped here and never reach the output, the log, or the summary.
if ! jq '[ .[] | {
      tool: "gitleaks",
      rule_id: .RuleID,
      severity: "HIGH",
      file: .File,
      line: .StartLine,
      commit: (.Commit // ""),
      message: (.Description // .RuleID),
      blocking: true
    } ]' "$raw" >"$out" 2>/dev/null; then
  die "gitleaks report was not valid JSON (scope: ${scope})"
fi

count="$(jq 'length' "$out" 2>/dev/null)" || die "could not read normalized findings"

if [[ "$count" -gt 0 ]]; then
  log "Secret scan: ${count} finding(s) in ${scope}"
  # Name the offending files so the failure is actionable without the raw
  # report. Rule, file, and line only -- never the matched content.
  jq -r '.[] | "  \(.rule_id) \(.file):\(.line)"' "$out" >&2
  exit "$EXIT_FINDINGS"
fi

log "Secret scan: ran over ${scope}, 0 findings"
exit "$EXIT_CLEAN"
