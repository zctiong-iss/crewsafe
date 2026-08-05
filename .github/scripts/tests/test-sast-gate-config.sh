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
# The Sonar Maven plugin does NOT read sonar-project.properties -- this repo
# used to invoke it (org.sonarsource.scanner.maven), which failed CI with "you
# must define sonar.organization", and then -- even after that specific
# property was patched in -- silently dropped web/ and mobile/ from analysis,
# because the Maven plugin resolves sonar.sources relative to the invoked
# module's own basedir and is documented to skip paths outside it, which
# sonar.projectBaseDir does not override for a non-multi-module project
# (SCRUM-178, 2026-08-06). Switching to the official standalone scanner action
# removes the whole class of problem: it has no Maven module-scoping concept
# and reads this file directly. These assertions exist so a regression back to
# the Maven-plugin approach cannot recur silently.

# Comments stripped for the negative half: the workflow's own history comment
# names sonar-maven-plugin in prose (explaining what was replaced), which would
# otherwise trip this check on the very explanation of why it's gone.
sast_code_only="$(without_comments <(printf '%s' "$sast"))"
check "sast job uses the official Sonar scan action, not the Maven plugin" \
  "$([[ "$sast" == *"SonarSource/sonarqube-scan-action"* ]] && \
     [[ "$sast_code_only" != *"sonar-maven-plugin"* ]] && \
     [[ "$sast_code_only" != *"org.sonarsource.scanner.maven"* ]] && \
     echo true || echo false)"

check "backend is compiled (Java bytecode analysis needs .class files)" \
  "$([[ "$sast" == *"compile"* ]] && echo true || echo false)"

# Kept as a lightweight style guard, not a correctness requirement: the scan
# action's own properties reader handles Java-properties backslash
# continuation correctly (unlike the removed hand-rolled bash loader), but
# single-line values stay simpler to diff and to eyeball for drift.
continuation_re='\\[[:space:]]*$'
check "sonar-project.properties values are single-line (style)" \
  "$(without_comments "$SONAR_PROPS" | grep -qE "$continuation_re" && echo false || echo true)"

# --- Quality Gate composition (research R2a) -------------------------------
# backend/pom.xml has no JaCoCo plugin, so a coverage condition would report 0%
# and block every merge for a reason unrelated to security. If coverage is ever
# introduced deliberately, JaCoCo must land first and this assertion updated.

check "no coverage condition configured while JaCoCo is absent" \
  "$(grep -qi 'jacoco' "$POM" && echo skip || (without_comments "$SONAR_PROPS" | grep -qi 'coverage' && echo false || echo true))"

# --- frontend/service coverage (FR-004 / US3) -------------------------------
# web/, mobile/, and ml-service/ all landed real source during this branch's
# lifetime -- all three are analysed now, not left as a future TODO.

check "web/, mobile/, and ml-service are in sonar.sources, not just mentioned in prose" \
  "$(grep -E '^sonar\.sources=' "$SONAR_PROPS" | grep -q 'web/' && \
     grep -E '^sonar\.sources=' "$SONAR_PROPS" | grep -q 'mobile/' && \
     grep -E '^sonar\.sources=' "$SONAR_PROPS" | grep -q 'ml-service' && \
     echo true || echo false)"

# --- secret gate must not be path-filtered (FR-001) ------------------------
# Lives here because it is the same class of silent-downgrade risk: adding a
# paths: filter would make the gate stop covering most of the repository while
# still reporting green.

check "workflow has no paths: filter" \
  "$(! grep -qE '^\s+paths:' "$WORKFLOW" && echo true || echo false)"

check "workflow runs on pull_request and push to main" \
  "$(grep -q 'pull_request:' "$WORKFLOW" && grep -q '^  push:' "$WORKFLOW" && echo true || echo false)"

# push was briefly removed on 2026-08-07 to save SAST quota on merge commits,
# then restored the same day: with no push trigger, SonarQube's own "main"
# branch snapshot never refreshes at all -- PR-scoped analyses don't touch it
# -- and it was found stuck on a stale, wrong-scope analysis from before the
# sonar-maven-plugin -> scan-action fix (main was last scanned by the OLD,
# backend-only mechanism, and nothing had re-scanned it since). SAST's own
# `if:` excludes schedule runs only; it must not ALSO exclude push, or main's
# snapshot silently goes stale again even with the trigger present.
check "SAST job's own if-condition excludes only schedule, not push" \
  "$(sast_if_condition="$(printf '%s\n' "$sast" | grep 'if:' || true)"; \
     [[ "$sast_if_condition" == *"!= 'schedule'"* ]] && \
     [[ "$sast_if_condition" != *"push"* ]] && \
     echo true || echo false)"

check "workflow has a scheduled full-history sweep, at least daily" \
  "$(grep -qE '^\s+- cron: "0 [0-9]+ \* \* \*"' "$WORKFLOW" && echo true || echo false)"

finish
