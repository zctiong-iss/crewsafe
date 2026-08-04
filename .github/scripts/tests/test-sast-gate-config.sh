#!/usr/bin/env bash
# Configuration lint for the SonarQube SAST gate (SCRUM-178, FR-015).
#
# NOT a behavioural test, and it does not pretend to be one. SonarQube's
# analyser lives behind an authenticated SaaS and cannot be run hermetically in
# a throwaway directory the way a local engine could, so "a real High finding
# blocks a pull request" is demonstrated once as reviewer evidence instead.
#
# What this file protects against is the failure mode that WOULD otherwise go
# unnoticed: a configuration change that quietly turns the gate off while it
# keeps reporting green. That is what makes it worth having.
set -euo pipefail

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/harness.sh"

WORKFLOW="$REPO_ROOT/.github/workflows/security-scan.yml"
SONAR_PROPS="$REPO_ROOT/sonar-project.properties"
POM="$REPO_ROOT/backend/pom.xml"

printf 'test-sast-gate-config\n'

for f in "$WORKFLOW" "$SONAR_PROPS"; do
  if [[ ! -f "$f" ]]; then
    printf '  FATAL required file not found: %s\n' "$f" >&2
    exit 1
  fi
done

check() {
  local label="$1" condition="$2"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ "$condition" == "true" ]]; then
    _pass "$label"
  else
    _fail "$label"
  fi
}

# Strip full-line comments before matching. Both files explain in prose WHY
# certain constructs are avoided, and a naive grep would match the explanation
# and report the very thing it is asserting against.
without_comments() {
  sed -e 's/[[:space:]]*#.*$//' "$1"
}

sast_block() {
  # The sast job only, so assertions cannot be satisfied by another job.
  awk '/^  sast:/{f=1} /^  [a-z-]+:$/{if($0 !~ /^  sast:/) f=0} f' "$WORKFLOW"
}

sast="$(sast_block)"

# --- the gate must actually gate ------------------------------------------

check "sonar.qualitygate.wait=true is set" \
  "$([[ "$sast" == *"sonar.qualitygate.wait=true"* ]] && echo true || echo false)"

check "sonar.qualitygate.timeout is bounded" \
  "$([[ "$sast" == *"sonar.qualitygate.timeout="* ]] && echo true || echo false)"

# --- nothing may soften the result ----------------------------------------

check "sast job has no continue-on-error" \
  "$([[ "$sast" != *"continue-on-error"* ]] && echo true || echo false)"

check "sast job does not swallow status with || true" \
  "$([[ "$sast" != *"|| true"* ]] && echo true || echo false)"

check "missing SONAR_TOKEN fails rather than skips" \
  "$([[ "$sast" == *'-z "${SONAR_TOKEN}"'* ]] && echo true || echo false)"

# --- privilege boundary ----------------------------------------------------

check "workflow never uses pull_request_target" \
  "$(without_comments "$WORKFLOW" | grep -q 'pull_request_target' && echo false || echo true)"

check "workflow permissions are contents: read only" \
  "$(grep -A1 '^permissions:' "$WORKFLOW" | grep -q 'contents: read' && echo true || echo false)"

# --- Sonar project identity ------------------------------------------------

check "sonar.projectKey is declared" \
  "$(grep -qE '^sonar\.projectKey=.+' "$SONAR_PROPS" && echo true || echo false)"

check "sonar.organization is declared" \
  "$(grep -qE '^sonar\.organization=.+' "$SONAR_PROPS" && echo true || echo false)"

check "sonar.sources is declared" \
  "$(grep -qE '^sonar\.sources=.+' "$SONAR_PROPS" && echo true || echo false)"

# --- sonar-project.properties is actually consumed --------------------------
# The Maven Sonar plugin does NOT read sonar-project.properties itself -- that
# format is a sonar-scanner-CLI convention only. A prior version of this
# workflow declared the file but never loaded it, which failed CI with "you
# must define sonar.organization" the moment it ran (SCRUM-178, 2026-08-06).
# These assertions exist so that regression cannot recur silently.

check "sast job loads sonar-project.properties" \
  "$([[ "$sast" == *"sonar-project.properties"* ]] && echo true || echo false)"

check "sast job sets sonar.projectBaseDir" \
  "$([[ "$sast" == *"sonar.projectBaseDir"* ]] && echo true || echo false)"

# Every value in sonar-project.properties MUST be a single line: the workflow's
# loader does not understand Java-properties backslash continuation, and a
# continued line would be split into a malformed key and a value-only
# fragment. Fail loudly here rather than let CI discover it.
continuation_re='\\[[:space:]]*$'
check "sonar-project.properties has no line-continuation backslashes" \
  "$(without_comments "$SONAR_PROPS" | grep -qE "$continuation_re" && echo false || echo true)"

# --- Quality Gate composition (research R2a) -------------------------------
# backend/pom.xml has no JaCoCo plugin, so a coverage condition would report 0%
# and block every merge for a reason unrelated to security. If coverage is ever
# introduced deliberately, JaCoCo must land first and this assertion updated.

check "no coverage condition configured while JaCoCo is absent" \
  "$(grep -qi 'jacoco' "$POM" && echo skip || (without_comments "$SONAR_PROPS" | grep -qi 'coverage' && echo false || echo true))"

# --- frontend coverage (FR-004 / US3) ---------------------------------------
# web/ and mobile/ landed real TypeScript/React source during this branch's
# lifetime (SCRUM-161/172/186 for mobile) -- they are analysed now, not left as
# a future TODO. ml-service/ remains .gitkeep-only and stays listed so it picks
# up analysis automatically once it gains source, with no pipeline edit.

check "web/ and mobile/ are in sonar.sources, not just mentioned in prose" \
  "$(grep -E '^sonar\.sources=' "$SONAR_PROPS" | grep -q 'web/' && \
     grep -E '^sonar\.sources=' "$SONAR_PROPS" | grep -q 'mobile/' && \
     echo true || echo false)"

# --- secret gate must not be path-filtered (FR-001) ------------------------
# Lives here because it is the same class of silent-downgrade risk: adding a
# paths: filter would make the gate stop covering most of the repository while
# still reporting green.

check "workflow has no paths: filter" \
  "$(! grep -qE '^\s+paths:' "$WORKFLOW" && echo true || echo false)"

check "workflow runs on pull_request and push to main" \
  "$(grep -q 'pull_request:' "$WORKFLOW" && grep -q 'push:' "$WORKFLOW" && echo true || echo false)"

check "workflow has a scheduled full-history sweep" \
  "$(grep -q 'schedule:' "$WORKFLOW" && echo true || echo false)"

finish
