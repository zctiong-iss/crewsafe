#!/usr/bin/env bash
# Render an allowlisted, redacted Trivy vulnerability summary. Never print raw
# scanner JSON or free-form descriptions into CI logs or job summaries.
set -euo pipefail

fail() {
  local message="$1"
  printf 'ERROR: %s\n' "$message" >&2
  exit 1
}

[[ $# -ge 5 && $# -le 7 ]] \
  || fail "usage: summarize-trivy-report.sh <report.json> <summary.md> <image> <revision> <policy-mode> [title] [active-ignorefile]"
REPORT="$1"
SUMMARY="$2"
IMAGE="$3"
REVISION="$4"
POLICY_MODE="$5"
TITLE='ML-service container vulnerability scan'
EXCEPTIONS=''
if (( $# >= 6 )); then TITLE="$6"; fi
if (( $# >= 7 )); then EXCEPTIONS="$7"; fi
case "$TITLE" in
  'ML-service container vulnerability scan'|'Backend image vulnerability scan') ;;
  *) fail "unsupported summary title" ;;
esac
case "$POLICY_MODE" in
  report-only|blocking) ;;
  *) fail "unsupported Trivy policy mode" ;;
esac

POLICY_OWNER="${POLICY_OWNER:-CrewSafe security team}"
POLICY_EXPIRES="${POLICY_EXPIRES:-2026-09-17}"
POLICY_EVALUATED_ON="${POLICY_EVALUATED_ON:-not-provided}"

[[ -s "$REPORT" ]] || fail "Trivy report is missing or empty"
command -v jq >/dev/null 2>&1 || fail "jq is required to summarize the Trivy report"
jq -e '
  type == "object"
  and (.ArtifactName | type == "string")
  and (.ArtifactType == "container_image")
  and (.Results | type == "array")
' "$REPORT" >/dev/null || fail "Trivy report is not the expected container-image JSON shape"

artifact_name="$(jq -r '.ArtifactName' "$REPORT")"
[[ "$artifact_name" == "$IMAGE" ]] || fail "Trivy report image does not match the candidate image"

clean_scalar() {
  local value="$1"
  jq -nr --arg value "$value" \
    '$value | tostring | gsub("[^A-Za-z0-9._+:/@=\\-]"; "?") | .[0:160]'
}

safe_image="$(clean_scalar "$IMAGE")"
safe_revision="$(clean_scalar "$REVISION")"

exception_list=''
if [[ -n "$EXCEPTIONS" ]]; then
  [[ -f "$EXCEPTIONS" ]] || fail "active Trivy ignorefile is missing"
  while IFS= read -r exception_id || [[ -n "$exception_id" ]]; do
    [[ -z "$exception_id" ]] && continue
    [[ "$exception_id" =~ ^CVE-[0-9]{4}-[0-9]+$ || "$exception_id" =~ ^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$ ]] \
      || fail "active Trivy ignorefile contains an invalid advisory identifier"
    if [[ -n "$exception_list" ]]; then exception_list+=", "; fi
    exception_list+="$exception_id"
  done <"$EXCEPTIONS"
fi
[[ -n "$exception_list" ]] || exception_list='none'

high_critical_count="$(jq '[.Results[]?.Vulnerabilities[]? | select(.Severity == "HIGH" or .Severity == "CRITICAL")] | length' "$REPORT")"
if [[ "$high_critical_count" -eq 0 ]]; then
  decision='clean'
elif [[ "$POLICY_MODE" == 'report-only' ]]; then
  decision='report-only-with-findings'
else
  decision='blocked'
fi
safe_rows="$(jq -r '
  def clean: tostring | gsub("[^A-Za-z0-9._+:/@=\\-]"; "?") | .[0:160];
  .Results[]?.Vulnerabilities[]?
  | select(.Severity == "HIGH" or .Severity == "CRITICAL")
  | "| \((.VulnerabilityID // "unknown") | clean) | \((.Severity // "unknown") | clean) | \((.PkgName // "unknown") | clean) | \((.InstalledVersion // "unknown") | clean) | \((.FixedVersion // "not-fixed") | clean) |"
' "$REPORT")"

mkdir -p "$(dirname "$SUMMARY")"
tmp_summary="$(mktemp)"
trap 'rm -f "$tmp_summary"' EXIT INT TERM

{
  printf '## %s\n' "$TITLE"
  printf -- '- Revision: %s\n' "$safe_revision"
  printf -- '- Image: %s\n' "$safe_image"
  printf -- '- HIGH/CRITICAL findings: %s\n' "$high_critical_count"
  printf -- '- Decision: %s\n' "$decision"
  printf -- '- Policy mode: %s\n' "$(clean_scalar "$POLICY_MODE")"
  printf -- '- Policy owner: %s\n' "$(clean_scalar "$POLICY_OWNER")"
  printf -- '- Policy expiry (UTC): %s\n' "$(clean_scalar "$POLICY_EXPIRES")"
  printf -- '- Policy evaluated on (UTC): %s\n' "$(clean_scalar "$POLICY_EVALUATED_ON")"
  printf -- '- Active exception identifiers supplied to scan: %s\n' "$(clean_scalar "$exception_list")"
  if [[ -n "$safe_rows" ]]; then
    printf '\n%s\n' '| Advisory | Severity | Package | Installed | Fixed |'
    printf '%s\n' '|---|---|---|---|---|'
    printf '%s\n' "$safe_rows"
  fi
  printf '\n%s\n' "- Full machine-readable evidence is retained only in this run's short-retention artifact."
} >"$tmp_summary"

cat "$tmp_summary" >>"$SUMMARY"

[[ "$decision" != 'blocked' ]] || exit 1
