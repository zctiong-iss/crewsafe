#!/usr/bin/env bash
# Convert a private ZAP report into bounded, reviewable DAST evidence.
set -euo pipefail

usage() {
  printf 'Usage: %s RAW_REPORT OUTPUT_REPORT\n' "$(basename "$0")" >&2
}

fail() {
  local failure_reason="$1"
  printf 'DAST report sanitization failed: %s\n' "$failure_reason" >&2
  exit 1
}

[[ $# -eq 2 ]] || { usage; exit 2; }

raw_report="$1"
output_report="$2"
[[ -s "$raw_report" ]] || fail 'raw report is missing or empty'
command -v jq >/dev/null 2>&1 || fail 'jq is required'
: "${DAST_ENVIRONMENT:?DAST_ENVIRONMENT is required}"
[[ "$DAST_ENVIRONMENT" == 'staging' ]] || fail 'only staging reports may be published'

output_dir="${output_report%/*}"
[[ "$output_dir" == "$output_report" ]] && output_dir='.'
mkdir -p "$output_dir"

# Remove any stale output before validation so a failed run cannot publish an older report.
rm -f "$output_report"
umask 077
tmp_output="$(mktemp "$output_report.tmp.XXXXXX")"
cleanup() { rm -f "$tmp_output"; }
trap cleanup EXIT INT TERM

if ! jq -e 'type == "object"' "$raw_report" >/dev/null 2>&1; then
  fail 'report is not valid JSON object data'
fi

scanner_version="$(jq -r '.about.version // empty' "$raw_report")"
generated_at="$(jq -r '.about.generated // .about.generatedAt // empty' "$raw_report")"
sites_scanned="$(jq -r '[.site[]?] | length' "$raw_report")"
endpoints_scanned="$(jq -r '[.insights[]? | select(.key == "insight.endpoint.total") | (.statistic | tonumber?)] | add // 0' "$raw_report")"

[[ -n "$scanner_version" ]] || fail 'scanner version is missing'
[[ -n "$generated_at" ]] || fail 'report timestamp is missing'
[[ "$sites_scanned" =~ ^[0-9]+$ && "$sites_scanned" -gt 0 ]] || fail 'report has no scanned sites'
[[ "$endpoints_scanned" =~ ^[0-9]+$ && "$endpoints_scanned" -gt 0 ]] || fail 'report has zero scanned endpoints'

if ! jq -e \
  --arg environment "$DAST_ENVIRONMENT" \
  --arg scanner_version "$scanner_version" \
  --arg generated_at "$generated_at" \
  --argjson sites "$sites_scanned" \
  --argjson endpoints "$endpoints_scanned" \
  '
    def text_or_unknown:
      if . == null or (tostring | length) == 0 then "Unknown" else tostring end;
    def clean_host:
      tostring | sub("^https?://"; "") | split("/")[0] | split("?")[0];
    def clean_path:
      tostring | sub("^https?://[^/]+"; "") | sub("\\?.*$"; "") |
      if . == "" then "/" else . end;

    [
      .site[]? as $site |
      $site.alerts[]? as $alert |
      {
        plugin_id: ($alert.pluginid // $alert.pluginId // $alert.id | text_or_unknown),
        name: ($alert.alert // $alert.name | text_or_unknown),
        risk: ($alert.riskdesc // $alert.risk | text_or_unknown),
        confidence: ($alert.confidence | text_or_unknown),
        cwe_id: ($alert.cweid // $alert.cwe // null),
        host: ($site.name // "unknown" | clean_host),
        paths: [($alert.instances // [])[]?.uri? | clean_path] | unique | .[0:10],
        instance_count: (($alert.instances // []) | length),
        risk_code: (($alert.riskcode // "0") | tostring)
      }
    ] as $all_findings |
    {
      scanner: { program: "ZAP", version: $scanner_version },
      generated_at: $generated_at,
      environment: $environment,
      coverage: { sites: $sites, endpoints: $endpoints },
      finding_counts: {
        high: ([$all_findings[] | select(.risk_code == "3")] | length),
        medium: ([$all_findings[] | select(.risk_code == "2")] | length),
        low: ([$all_findings[] | select(.risk_code == "1")] | length),
        informational: ([$all_findings[] | select(.risk_code == "0")] | length)
      },
      findings: [$all_findings[] | del(.risk_code)],
      redaction: { status: "complete", schema_version: 1 }
    }
  ' "$raw_report" >"$tmp_output"; then
  fail 'could not build the bounded report'
fi

for forbidden_key in param attack evidence otherinfo requestHeader responseHeader responseBody cookies authorization token password; do
  if jq -e --arg key "$forbidden_key" \
    '[.. | objects | keys[]?] | any(. == $key or (ascii_downcase == ($key | ascii_downcase)))' \
    "$tmp_output" >/dev/null 2>&1; then
    fail 'sanitized output contains a forbidden field'
  fi
done

if jq -e '[.findings[].paths[] | contains("?")] | any' "$tmp_output" >/dev/null 2>&1; then
  fail 'sanitized output contains a query string'
fi

# This check is deliberately applied to the bounded output, never printed raw input.
if jq -r '.. | strings' "$tmp_output" | LC_ALL=C grep -Eiq \
  'Bearer[[:space:]]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|[?&](code|state|token|session|access_token)=|[[:alnum:]._%+-]+@[[:alnum:].-]+\.[A-Za-z]{2,}'; then
  fail 'sanitized output contains secret-like or personal data'
fi

mv "$tmp_output" "$output_report"
trap - EXIT INT TERM
chmod 600 "$output_report"
