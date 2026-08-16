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
  local file="$1"
  sed -e 's/[[:space:]]*#.*$//' "$file"
}

sast_block() {
  # The sast job only, so assertions cannot be satisfied by another job.
  awk '/^  sast:/{f=1} /^  [a-z-]+:$/{if($0 !~ /^  sast:/) f=0} f' "$WORKFLOW"
}

sast="$(sast_block)"

import_block() {
  awk '/^  sonar-securityhub-import:/{f=1} /^  [a-z-]+:$/{if($0 !~ /^  sonar-securityhub-import:/) f=0} f' "$WORKFLOW"
}

import_job="$(import_block)"

check "Sonar Security Hub import job exists" \
  "$([[ -n "$import_job" ]] && echo true || echo false)"
check "import job waits for SAST completion" \
  "$([[ "$import_job" == *"needs: sast"* ]] && echo true || echo false)"
check "import job runs when SAST concludes unsuccessfully" \
  "$([[ "$import_job" == *"always() &&"* ]] && echo true || echo false)"
check "import job is restricted to main push or manual dispatch" \
  "$([[ "$import_job" == *"github.event_name == 'push'"* && "$import_job" == *"github.event_name == 'workflow_dispatch'"* && "$import_job" == *"github.ref == 'refs/heads/main'"* ]] && echo true || echo false)"
check "import job validates its role configuration" \
  "$([[ "$import_job" == *"CREWSAFE_SONAR_SECURITYHUB_IMPORT_ROLE_ARN is not configured"* ]] && echo true || echo false)"
check "import job has read-only GitHub plus OIDC permissions" \
  "$([[ "$import_job" == *"contents: read"* && "$import_job" == *"id-token: write"* && "$import_job" != *"contents: write"* ]] && echo true || echo false)"
check "import job has visible inactive state" \
  "$([[ "$import_job" == *"NOT-ACTIVATED"* ]] && echo true || echo false)"
check "import job invokes the bounded importer" \
  "$([[ "$import_job" == *".github/scripts/security/import-sonar-securityhub.sh"* ]] && echo true || echo false)"
check "import job has a ten-minute upper bound" \
  "$([[ "$import_job" == *"timeout-minutes: 10"* ]] && echo true || echo false)"

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

check "Java test bytecode is configured" \
  "$(grep -q '^sonar\.java\.test\.binaries=backend/target/test-classes$' "$SONAR_PROPS" && echo true || echo false)"

check "Java dependency libraries are configured" \
  "$(grep -q '^sonar\.java\.libraries=backend/target/dependency/\*\.jar$' "$SONAR_PROPS" && echo true || echo false)"

check "Java test dependency libraries are configured" \
  "$(grep -q '^sonar\.java\.test\.libraries=backend/target/dependency/\*\.jar,backend/target/test-dependency/\*\.jar$' "$SONAR_PROPS" && echo true || echo false)"

check "SAST prepares backend dependency libraries before scanning" \
  "$([[ "$sast" == *"maven-dependency-plugin:3.8.1:copy-dependencies"* ]] && \
     [[ "$sast" == *"target/test-dependency"* ]] && echo true || echo false)"

check "web and mobile LCOV import paths are both declared" \
  "$(grep -q '^sonar\.javascript\.lcov\.reportPaths=web/coverage/sonar-lcov\.info,mobile/coverage/sonar-lcov\.info$' "$SONAR_PROPS" && echo true || echo false)"

check "SAST generates and prepares mobile coverage before scanning" \
  "$([[ "$sast" == *"npm run test:coverage"* ]] && \
     [[ "$sast" == *"mobile/coverage/sonar-lcov.info"* ]] && echo true || echo false)"

check "SAST generates and prepares web coverage before scanning" \
  "$([[ "$sast" == *"Generate web coverage"* ]] && \
     [[ "$sast" == *"web/coverage/sonar-lcov.info"* ]] && echo true || echo false)"

check "web dependencies are installed for TypeScript analysis" \
  "$([[ "$sast" == *"Install web dependencies for analysis"* ]] && \
     [[ "$sast" == *"working-directory: web"* ]] && echo true || echo false)"

check "TypeScript project configurations are declared" \
  "$(grep -q '^sonar\.typescript\.tsconfigPaths=web/tsconfig\.json,mobile/tsconfig\.json$' "$SONAR_PROPS" && echo true || echo false)"

check "Java analysis version is declared" \
  "$(grep -q '^sonar\.java\.source=21$' "$SONAR_PROPS" && echo true || echo false)"

check "Python analysis version is declared" \
  "$(grep -q '^sonar\.python\.version=3\.11$' "$SONAR_PROPS" && echo true || echo false)"

check "ML-service Python coverage import path is declared" \
  "$(grep -q '^sonar\.python\.coverage\.reportPaths=ml-service/coverage\.xml$' "$SONAR_PROPS" && echo true || echo false)"

check "ML-service coverage is generated and validated before scanning" \
  "$(python_step="$(printf '%s\n' "$sast" | grep -n 'Set up Python 3.11 for ML-service coverage' | cut -d: -f1)"; \
     coverage_step="$(printf '%s\n' "$sast" | grep -n 'Generate ML-service coverage' | cut -d: -f1)"; \
     validation_step="$(printf '%s\n' "$sast" | grep -n 'Validate ML-service coverage report' | cut -d: -f1)"; \
     scan_step="$(printf '%s\n' "$sast" | grep -n 'Analyse with SonarQube Cloud' | cut -d: -f1)"; \
     [[ -n "$python_step" && -n "$coverage_step" && -n "$validation_step" && -n "$scan_step" && "$python_step" -lt "$coverage_step" && "$coverage_step" -lt "$validation_step" && "$validation_step" -lt "$scan_step" ]] && echo true || echo false)"

check "PostgreSQL SQL is not treated as Oracle PL/SQL" \
  "$(grep -q '^sonar\.plsql\.file\.suffixes=\.pls,\.plb,\.pck,\.pkb,\.pks$' "$SONAR_PROPS" && echo true || echo false)"

# Kept as a lightweight style guard, not a correctness requirement: the scan
# action's own properties reader handles Java-properties backslash
# continuation correctly (unlike the removed hand-rolled bash loader), but
# single-line values stay simpler to diff and to eyeball for drift.
continuation_re='\\[[:space:]]*$'
check "sonar-project.properties values are single-line (style)" \
  "$(without_comments "$SONAR_PROPS" | grep -qE "$continuation_re" && echo false || echo true)"

# --- Quality Gate composition (research R2a) -------------------------------
# JaCoCo landed in backend/pom.xml (SCRUM-168) specifically so the Quality
# Gate's coverage condition reads real numbers. Both halves must be present
# together: a coverage path with no plugin produces a report Sonar can never
# find; a plugin with no declared path produces a report Sonar never looks for.

check "JaCoCo plugin is configured in backend/pom.xml" \
  "$(grep -qi 'jacoco-maven-plugin' "$POM" && echo true || echo false)"

check "sonar.coverage.jacoco.xmlReportPaths is declared" \
  "$(grep -qE '^sonar\.coverage\.jacoco\.xmlReportPaths=.+' "$SONAR_PROPS" && echo true || echo false)"

# --- frontend coverage (FR-004 / US3) ---------------------------------------
# web/ and mobile/ landed real TypeScript/React source during this branch's
# lifetime (SCRUM-161/172/186 for mobile) -- they are analysed now, not left as
# a future TODO. ml-service/ is also included because it contains the Python
# FastAPI spike.

sonar_sources="$(grep -E '^sonar\.sources=' "$SONAR_PROPS")"
sonar_tests="$(grep -E '^sonar\.tests=' "$SONAR_PROPS")"
sonar_test_inclusions="$(grep -E '^sonar\.test\.inclusions=' "$SONAR_PROPS")"

check "web/ and mobile/ are in sonar.sources, not just mentioned in prose" \
  "$(printf '%s' "$sonar_sources" | grep -q 'web/' && \
     printf '%s' "$sonar_sources" | grep -q 'mobile/' && \
     echo true || echo false)"

check "ML-service remains a production source and test files are classified as tests" \
  "$(printf '%s' "$sonar_sources" | grep -q 'ml-service' && \
     printf '%s' "$sonar_tests" | grep -q 'ml-service' && \
     printf '%s' "$sonar_test_inclusions" | grep -q 'ml-service/test_\*\.py' && \
     echo true || echo false)"

check "infrastructure and deployment paths are in sonar.sources" \
  "$(printf '%s' "$sonar_sources" | grep -q 'infra/terraform' && \
     printf '%s' "$sonar_sources" | grep -q '\.github/workflows' && \
     printf '%s' "$sonar_sources" | grep -q 'backend/Dockerfile' && \
     printf '%s' "$sonar_sources" | grep -q 'local/compose.yaml' && \
     echo true || echo false)"

check "deployment metadata paths are in sonar.sources" \
  "$(printf '%s' "$sonar_sources" | grep -q '\.github/terraform' && \
     printf '%s' "$sonar_sources" | grep -q '\.github/cognito' && \
     printf '%s' "$sonar_sources" | grep -q '\.github/scripts' && \
     echo true || echo false)"

check "generated and Terraform state paths are excluded" \
  "$(grep -E '^sonar\.exclusions=' "$SONAR_PROPS" | grep -q '\*\*/\.terraform/\*\*' && \
     grep -E '^sonar\.exclusions=' "$SONAR_PROPS" | grep -q '\*\*/\*\.tfstate\*' && \
     grep -E '^sonar\.exclusions=' "$SONAR_PROPS" | grep -q '\*\*/coverage/\*\*' && \
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
