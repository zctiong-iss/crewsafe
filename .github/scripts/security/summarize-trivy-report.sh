#!/usr/bin/env bash
# Render an allowlisted, redacted Trivy vulnerability summary. Never print raw
# scanner JSON or free-form descriptions into CI logs or job summaries.
set -euo pipefail

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

[[ $# -ge 4 && $# -le 5 ]] || fail "usage: summarize-trivy-report.sh <report.json> <summary.md> <image> <revision> [title]"
REPORT="$1"
SUMMARY="$2"
IMAGE="$3"
REVISION="$4"
TITLE="${5:-ML-service container vulnerability scan}"
case "$TITLE" in
  'ML-service container vulnerability scan'|'Backend image vulnerability scan') ;;
  *) fail "unsupported summary title" ;;
esac

[[ -s "$REPORT" ]] || fail "Trivy report is missing or empty"
command -v jq >/dev/null 2>&1 || fail "jq is required to summarize the Trivy report"
jq -e 'type == "object" and (.Results | type == "array")' "$REPORT" >/dev/null \
  || fail "Trivy report is not the expected JSON shape"

mkdir -p "$(dirname "$SUMMARY")"
tmp_summary="$(mktemp)"
trap 'rm -f "$tmp_summary"' EXIT INT TERM

high_critical_count="$(jq '[.Results[]?.Vulnerabilities[]? | select(.Severity == "HIGH" or .Severity == "CRITICAL")] | length' "$REPORT")"
safe_rows="$(jq -r '
  def clean: tostring | gsub("[^A-Za-z0-9._+:/@=\\-]"; "?") | .[0:160];
  .Results[]?.Vulnerabilities[]?
  | select(.Severity == "HIGH" or .Severity == "CRITICAL")
  | "| \((.VulnerabilityID // "unknown") | clean) | \((.Severity // "unknown") | clean) | \((.PkgName // "unknown") | clean) | \((.InstalledVersion // "unknown") | clean) | \((.FixedVersion // "not-fixed") | clean) |"
' "$REPORT")"

{
  printf '## %s\n' "$TITLE"
  printf -- "- Revision: \`%s\`\n" "$REVISION"
  printf -- "- Image: \`%s\`\n" "$IMAGE"
  printf -- "- HIGH/CRITICAL findings: \`%s\`\n" "$high_critical_count"
  if [[ -n "$safe_rows" ]]; then
    printf '\n%s\n' '| Advisory | Severity | Package | Installed | Fixed |'
    printf '%s\n' '|---|---|---|---|---|'
    printf '%s\n' "$safe_rows"
  fi
  printf '\n%s\n' "- Full machine-readable evidence is retained only in this run's short-retention artifact."
} >"$tmp_summary"

cat "$tmp_summary" >>"$SUMMARY"
