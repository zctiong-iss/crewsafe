#!/usr/bin/env bash
set -euo pipefail

: "${WEB_DISTRIBUTION_ID:?WEB_DISTRIBUTION_ID is required}"
: "${VITE_API_BASE_URL:?VITE_API_BASE_URL is required}"
: "${VITE_COGNITO_AUTHORITY:?VITE_COGNITO_AUTHORITY is required}"
: "${VITE_COGNITO_HOSTED_UI_DOMAIN:?VITE_COGNITO_HOSTED_UI_DOMAIN is required}"

distribution_json="$(aws cloudfront get-distribution-config \
  --id "$WEB_DISTRIBUTION_ID" \
  --output json)"

default_policy_id="$(jq -r \
  '.DistributionConfig.DefaultCacheBehavior.ResponseHeadersPolicyId // empty' \
  <<<"$distribution_json")"
index_policy_id="$(jq -r \
  '.DistributionConfig.CacheBehaviors.Items[]? |
   select(.PathPattern == "/index.html") |
   .ResponseHeadersPolicyId // empty' \
  <<<"$distribution_json")"

[[ -n "$default_policy_id" ]] || {
  echo "Default cache behaviour has no response-headers policy" >&2
  exit 1
}
[[ "$index_policy_id" == "$default_policy_id" ]] || {
  echo "Default and /index.html behaviours do not share one response-headers policy" >&2
  exit 1
}

policy_json="$(aws cloudfront get-response-headers-policy \
  --id "$default_policy_id" \
  --output json)"

enforced_csp="$(jq -r \
  '.ResponseHeadersPolicy.ResponseHeadersPolicyConfig.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy // empty' \
  <<<"$policy_json")"
report_only_csp="$(jq -r \
  '[.ResponseHeadersPolicy.ResponseHeadersPolicyConfig.CustomHeadersConfig.Items[]? |
    select((.Header | ascii_downcase) == "content-security-policy-report-only") |
    .Value][0] // empty' \
  <<<"$policy_json")"

if [[ -n "$enforced_csp" && -n "$report_only_csp" ]]; then
  echo "CSP is present in both enforced and Report-Only forms" >&2
  exit 1
fi

csp_value="${enforced_csp:-$report_only_csp}"
[[ -n "$csp_value" ]] || {
  echo "The attached policy contains no CSP" >&2
  exit 1
}

CSP_VALUE="$csp_value" \
API_URL="$VITE_API_BASE_URL" \
AUTHORITY_URL="$VITE_COGNITO_AUTHORITY" \
HOSTED_UI_URL="$VITE_COGNITO_HOSTED_UI_DOMAIN" \
node <<'NODE'
const csp = process.env.CSP_VALUE ?? "";
const directive = csp
  .split(";")
  .map((part) => part.trim())
  .find((part) => part.startsWith("connect-src "));

if (!directive) {
  throw new Error("CSP has no connect-src directive");
}

const actual = new Set(directive.split(/\s+/).slice(1));
const expected = new Set([
  "'self'",
  new URL(process.env.API_URL).origin,
  new URL(process.env.AUTHORITY_URL).origin,
  new URL(process.env.HOSTED_UI_URL).origin,
]);

const missing = [...expected].filter((value) => !actual.has(value));
const unexpected = [...actual].filter((value) => !expected.has(value));

if (missing.length || unexpected.length) {
  throw new Error(
    `CSP connect-src mismatch; missing=${missing.join(",") || "none"}; ` +
    `unexpected=${unexpected.join(",") || "none"}`,
  );
}
NODE

echo "Verified CloudFront response policy $default_policy_id against VITE_* origins."