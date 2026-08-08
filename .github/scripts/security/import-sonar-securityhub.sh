#!/usr/bin/env bash
# Import a deliberately narrow, redacted SonarCloud vulnerability subset as
# Security Hub custom findings. This script is invoked only by Security Scan's
# main-only job (push or manually dispatched); its CI and Terraform guards
# enforce that boundary separately.
set -euo pipefail

config_file="${CONFIG_FILE:-.github/securityhub-import.json}"
region="${AWS_REGION:-ap-southeast-1}"
expected_account="${CREWSAFE_SECURITYHUB_ACCOUNT_ID:-}"

safe_identifier='^[A-Za-z0-9_.:-]{1,160}$'
safe_timestamp='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$'
sonar_timestamp='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|\+00:00|\+0000)$'

result() { printf 'SONAR_SECURITYHUB_RESULT=%s\n' "$1"; }
fail() { result "FAILED reason=$1"; exit 1; }

[[ -f "$config_file" ]] || fail CONFIG_MISSING
jq -e 'type == "object" and (.enabled | type == "boolean")' "$config_file" >/dev/null \
  || fail CONFIG_INVALID
enabled="$(jq -r '.enabled' "$config_file")"
if [[ "$enabled" == false ]]; then
  result NOT-ACTIVATED
  exit 0
fi

[[ "${GITHUB_ACTIONS:-}" == true && \
  ( "${GITHUB_EVENT_NAME:-}" == push || "${GITHUB_EVENT_NAME:-}" == workflow_dispatch ) && \
  "${GITHUB_REF:-}" == refs/heads/main ]] || fail CI_SCOPE_DENIED
[[ "$region" == ap-southeast-1 ]] || fail REGION_DENIED
[[ "$expected_account" =~ ^[0-9]{12}$ ]] || fail ACCOUNT_CONFIG_INVALID
[[ "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || fail COMMIT_INVALID
[[ -n "${SONAR_SECURITYHUB_TOKEN:-}" ]] || fail SONAR_AUTH_MISSING

project_key="$(jq -r '.sonarProjectKey // empty' "$config_file")"
controlled_key="$(jq -r '.controlledIssueKey // empty' "$config_file")"
sonar_origin="https://sonarcloud.io"
[[ "$project_key" =~ $safe_identifier && "$controlled_key" =~ $safe_identifier ]] || fail CONFIG_IDENTIFIER_INVALID
jq -e --arg origin "$sonar_origin" '(.sonarHostUrl? == null or .sonarHostUrl == $origin)' "$config_file" >/dev/null \
  || fail CONFIG_ORIGIN_DENIED

caller_account="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)" \
  || fail AWS_IDENTITY_UNAVAILABLE
[[ "$caller_account" == "$expected_account" ]] || fail ACCOUNT_DENIED
product_arn="arn:aws:securityhub:${region}:${expected_account}:product/${expected_account}/default"

tmp_dir="$(mktemp -d)"
cleanup() { rm -rf "$tmp_dir"; }
trap cleanup EXIT

request_issues() {
  local query="$1"
  curl --fail --silent --show-error --connect-timeout 2 --max-time 3 \
    --header "Authorization: Bearer ${SONAR_SECURITYHUB_TOKEN}" \
    "${sonar_origin}/api/issues/search?${query}"
}

normalize_timestamp() {
  local timestamp="$1"
  [[ "$timestamp" =~ $sonar_timestamp ]] || return 1
  case "$timestamp" in
    *Z) printf '%s\n' "$timestamp" ;;
    *+0000) printf '%sZ\n' "${timestamp%+0000}" ;;
    *+00:00) printf '%sZ\n' "${timestamp%+00:00}" ;;
    *) return 1 ;;
  esac
}

active_json="$(request_issues "componentKeys=${project_key}&branch=main&types=VULNERABILITY&statuses=OPEN&impactSeverities=BLOCKER,HIGH&p=1&ps=100")" \
  || fail SONAR_UNAVAILABLE
lifecycle_json="$(request_issues "componentKeys=${project_key}&branch=main&issues=${controlled_key}&types=VULNERABILITY&statuses=RESOLVED&resolutions=FIXED&p=1&ps=1")" \
  || fail SONAR_UNAVAILABLE

jq -e 'type == "object" and (.total | type == "number") and (.issues | type == "array")' <<<"$active_json" >/dev/null \
  || fail SONAR_RESPONSE_INVALID
active_total="$(jq -r '.total' <<<"$active_json")"
[[ "$active_total" =~ ^[0-9]+$ && "$active_total" -le 100 ]] || fail SONAR_PAGE_LIMIT
[[ "$(jq '.issues | length' <<<"$active_json")" -le 100 ]] || fail SONAR_PAGE_LIMIT

validate_issue() {
  local issue="$1" desired_status="$2" desired_resolution="${3:-}"
  jq -e --arg project "$project_key" --arg status "$desired_status" --arg resolution "$desired_resolution" '
    def eligible_security_impact:
      if (.impacts? == null) then
        (.severity == "BLOCKER" or .severity == "HIGH")
      elif (.impacts | type) == "array" then
        any(.impacts[]?; .softwareQuality == "SECURITY" and
          (.severity == "BLOCKER" or .severity == "HIGH"))
      else false end;
    (.key | type == "string" and test("^[A-Za-z0-9_.:-]{1,160}$")) and
    ((.project // $project) == $project) and .type == "VULNERABILITY" and
    eligible_security_impact and .status == $status and
    ($resolution == "" or .resolution == $resolution) and
    (.rule | type == "string" and test("^[A-Za-z0-9_.:-]{1,160}$")) and
    (.creationDate | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,9})?(Z|\\+00:00|\\+0000)$")) and
    (.updateDate | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,9})?(Z|\\+00:00|\\+0000)$"))
  ' <<<"$issue" >/dev/null
}

security_severity() {
  jq -r '
    if (.impacts? == null) then .severity
    elif (.impacts | type) == "array" then
      ([.impacts[]? | select(.softwareQuality == "SECURITY") | .severity] |
        if index("BLOCKER") != null then "BLOCKER"
        elif index("HIGH") != null then "HIGH"
        else "" end)
    else "" end
  ' <<<"$1"
}

lookup_and_import() {
  local issue="$1" state="$2" action="$3" id lookup match_count existing_updated source_updated source_created payload response severity
  severity="$(security_severity "$issue")"
  [[ "$severity" == BLOCKER || "$severity" == HIGH ]] || fail CANDIDATE_INVALID
  source_created="$(normalize_timestamp "$(jq -r '.creationDate' <<<"$issue")")" || fail CANDIDATE_INVALID
  source_updated="$(normalize_timestamp "$(jq -r '.updateDate' <<<"$issue")")" || fail CANDIDATE_INVALID
  id="crewsafe/sonarcloud/${project_key}/$(jq -r '.key' <<<"$issue")"
  lookup="$(aws securityhub get-findings --region "$region" --filters "ProductArn=[{Value=${product_arn},Comparison=EQUALS}],Id=[{Value=${id},Comparison=EQUALS}]" --output json 2>/dev/null)" \
    || fail SECURITYHUB_LOOKUP_FAILED
  jq -e 'type == "object" and (.Findings | type == "array")' <<<"$lookup" >/dev/null || fail SECURITYHUB_RESPONSE_INVALID
  match_count="$(jq '[.Findings[] | select(.Id == $id and .ProductArn == $product)] | length' --arg id "$id" --arg product "$product_arn" <<<"$lookup")"
  [[ "$match_count" =~ ^[0-9]+$ && "$match_count" -le 1 ]] || fail AMBIGUOUS_IDENTITY
  if [[ "$action" == archive && "$match_count" == 0 ]]; then
    result REJECTED_RESOLVED_UNIMPORTED
    return 0
  fi
  if [[ "$match_count" == 1 ]]; then
    existing_updated="$(jq -r --arg id "$id" --arg product "$product_arn" '.Findings[] | select(.Id == $id and .ProductArn == $product) | .UpdatedAt' <<<"$lookup")"
    [[ "$existing_updated" =~ $safe_timestamp ]] || fail EXISTING_TIMESTAMP_INVALID
    if [[ "$source_updated" == "$existing_updated" || "$source_updated" < "$existing_updated" ]]; then
      result UNCHANGED
      return 0
    fi
  fi
  payload="$tmp_dir/finding.json"
  jq -n --arg id "$id" --arg product "$product_arn" --arg account "$expected_account" \
    --arg project "$project_key" --arg issue_key "$(jq -r '.key' <<<"$issue")" \
    --arg rule "$(jq -r '.rule' <<<"$issue")" --arg severity "$severity" \
    --arg created "$source_created" --arg updated "$source_updated" \
    --arg commit "$GITHUB_SHA" --arg state "$state" '
    [{SchemaVersion:"2018-10-08",Id:$id,ProductArn:$product,GeneratorId:"crewsafe/sonarcloud-securityhub-import",
      AwsAccountId:$account,CreatedAt:$created,UpdatedAt:$updated,RecordState:$state,
      Title:("SonarCloud vulnerability " + $severity + " rule " + $rule),
      Description:("Redacted SonarCloud vulnerability for project " + $project + ", rule " + $rule + ", commit " + $commit),
      FindingProviderFields:{Severity:(if $severity == "BLOCKER" then "CRITICAL" else "HIGH" end),Types:["Software and Configuration Checks/Vulnerabilities/CVE"]},
      ProductFields:{"crewsafe/sonarSeverity":$severity,"crewsafe/ruleKey":$rule},
      Resources:[{Type:"Other",Id:("crewsafe:sonarcloud:" + $project)}]}]
  ' >"$payload" || fail ASFF_BUILD_FAILED
  [[ "$(wc -c <"$payload" | tr -d ' ')" -le 245760 ]] || fail ASFF_SIZE_LIMIT
  response="$(aws securityhub batch-import-findings --region "$region" --findings "file://${payload}" --output json 2>/dev/null)" \
    || fail SECURITYHUB_IMPORT_FAILED
  jq -e 'type == "object" and (.FailedFindings | type == "array")' <<<"$response" >/dev/null || fail SECURITYHUB_RESPONSE_INVALID
  [[ "$(jq '.FailedFindings | length' <<<"$response")" == 0 ]] || { result FAILED_PARTIAL; return 1; }
  if [[ "$action" == archive ]]; then result "ARCHIVED id=${id}";
  elif [[ "$match_count" == 1 ]]; then result "UPDATED id=${id}";
  else result "IMPORTED id=${id}"; fi
}

active_count="$(jq '.issues | length' <<<"$active_json")"
for ((index=0; index<active_count; index++)); do
  issue="$(jq -c ".issues[$index]" <<<"$active_json")"
  validate_issue "$issue" OPEN || fail CANDIDATE_INVALID
done
for ((index=0; index<active_count; index++)); do
  issue="$(jq -c ".issues[$index]" <<<"$active_json")"
  lookup_and_import "$issue" ACTIVE import
done

jq -e 'type == "object" and (.total | type == "number") and (.issues | type == "array") and (.issues | length <= 1)' <<<"$lifecycle_json" >/dev/null \
  || fail LIFECYCLE_RESPONSE_INVALID
if [[ "$(jq '.issues | length' <<<"$lifecycle_json")" == 1 ]]; then
  issue="$(jq -c '.issues[0]' <<<"$lifecycle_json")"
  [[ "$(jq -r '.key' <<<"$issue")" == "$controlled_key" ]] || fail LIFECYCLE_KEY_DENIED
  validate_issue "$issue" RESOLVED FIXED || fail LIFECYCLE_INVALID
  lookup_and_import "$issue" ARCHIVED archive
fi
if [[ "$active_count" == 0 && "$(jq '.issues | length' <<<"$lifecycle_json")" == 0 ]]; then result 'REJECTED count=0'; fi
