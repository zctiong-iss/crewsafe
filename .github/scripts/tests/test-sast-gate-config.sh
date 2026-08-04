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

# --- Quality Gate composition (research R2a) -------------------------------
# backend/pom.xml has no JaCoCo plugin, so a coverage condition would report 0%
# and block every merge for a reason unrelated to security. If coverage is ever
# introduced deliberately, JaCoCo must land first and this assertion updated.

check "no coverage condition configured while JaCoCo is absent" \
  "$(grep -qi 'jacoco' "$POM" && echo skip || (without_comments "$SONAR_PROPS" | grep -qi 'coverage' && echo false || echo true))"

# --- forward compatibility (FR-004 / US3) ----------------------------------
# web/, mobile/ and ml-service/ are .gitkeep-only today. They must not be
# silently forgotten when they gain real source; sonar-project.properties
# carries a note, and this asserts the note survives.

check "future source trees (web/, mobile/) are noted in sonar-project.properties" \
  "$(grep -q 'web/' "$SONAR_PROPS" && grep -q 'mobile/' "$SONAR_PROPS" && echo true || echo false)"

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
