#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../../.." && pwd)"
workflow="$root/.github/workflows/mobsf-dynamic-scan.yml"
runbook="$root/docs/runbooks/SCRUM-350-mobsf-dynamic-scanning.md"
readonly SANITIZE_SCRIPT='sanitize-mobsf-report.sh'

# A bare `! rg -q ...` does not trigger errexit on match (SC2251), so every "must not contain"
# assertion below goes through this helper instead (mirrors test-mobile-native-build-workflow.sh).
assert_absent() {
  local pattern="$1" file="$2" label="$3"
  shift 3
  if rg -q "$@" -- "$pattern" "$file"; then
    echo "FAIL: found forbidden pattern ($label): $pattern" >&2
    exit 1
  fi
}

# --- Foundational assertions (auth_mode extension is covered by
#     test-mobile-native-build-workflow.sh's own assertions, not here) ---

android_section="$(rg -A 500 -- '^  android-dynamic-scan:' "$workflow" | rg -B 500 -m1 -- '^  ios-dynamic-scan:' || true)"
ios_section="$(rg -A 500 -- '^  ios-dynamic-scan:' "$workflow")"

# --- User Story 1 (Android) assertions ---

for needle in \
  'retrieve-and-verify-artifact.sh' \
  'reactivecircus/android-emulator-runner@a421e43855164a8197daf9d8d40fe71c6996bb0d' \
  'timeout-minutes: 10' \
  'start-mobsf-service.sh' \
  'synthetic-flow.android.yaml' \
  'evaluate-coverage-signal.sh' \
  'check-network-allowlist.sh' \
  "$SANITIZE_SCRIPT" \
  'retention-days: 14' \
  '--arg platform "android"' \
  'api/v1/upload' \
  'api/v1/dynamic/start_analysis' \
  'api/v1/dynamic/stop_analysis' \
  'api/v1/dynamic/report_json' \
  'X-Mobsf-Api-Key' \
  '.domains | keys' \
  'ANALYZER_IDENTIFIER: emulator-5554'
do
  echo "$android_section" | rg -q -F -- "$needle"
done

# MobSF's own hash (extracted from the upload response) must be what later dynamic-analysis
# calls key on -- never this workflow's own artifact_sha256 (verified against MobSF's source;
# see the "Upload artifact to MobSF" step's comment). A regression reintroducing
# artifact_sha256 into a start_analysis/stop_analysis/report_json call would defeat this.
mobsf_api_calls="$(echo "$android_section" | rg -A2 -F -- 'api/v1/dynamic/')"
echo "$mobsf_api_calls" | rg -q -F -- 'hash=${MOBSF_HASH}'
assert_absent 'hash=\$\{ARTIFACT_SHA256\}' "$workflow" 'MobSF hash must not be this workflow-s own SHA-256'

# sanitize-mobsf-report.sh must textually precede the upload-artifact step (SEC-003).
sanitize_line="$(echo "$android_section" | rg -n -F -m1 -- "$SANITIZE_SCRIPT" | cut -d: -f1)"
upload_line="$(echo "$android_section" | rg -n -F -m1 -- 'actions/upload-artifact' | cut -d: -f1)"
[[ -n "$sanitize_line" && -n "$upload_line" && "$sanitize_line" -lt "$upload_line" ]] \
  || { echo "FAIL: sanitize-mobsf-report.sh does not precede actions/upload-artifact in android-dynamic-scan" >&2; exit 1; }

# --- User Story 2 (iOS) assertions ---

for needle in \
  "runs-on: \${{ inputs.ios_runner_label || 'ubuntu-latest' }}" \
  'check-ios-analyzer-availability.sh' \
  'start-mobsf-service.sh' \
  'synthetic-flow.ios.yaml' \
  'evaluate-coverage-signal.sh' \
  'check-network-allowlist.sh' \
  "$SANITIZE_SCRIPT" \
  'retention-days: 14' \
  '--arg platform "ios"'
do
  echo "$ios_section" | rg -q -F -- "$needle"
done

# check-ios-analyzer-availability.sh must textually precede any artifact-install/MobSF/
# Maestro step -- the fail-closed check must run first (US2 Scenario 1).
availability_line="$(echo "$ios_section" | rg -n -F -m1 -- 'check-ios-analyzer-availability.sh' | cut -d: -f1)"
mobsf_line="$(echo "$ios_section" | rg -n -F -m1 -- 'start-mobsf-service.sh' | cut -d: -f1)"
[[ -n "$availability_line" && -n "$mobsf_line" && "$availability_line" -lt "$mobsf_line" ]] \
  || { echo "FAIL: check-ios-analyzer-availability.sh does not precede start-mobsf-service.sh in ios-dynamic-scan" >&2; exit 1; }

# sanitize-mobsf-report.sh must also precede upload in the iOS job (SEC-003).
ios_sanitize_line="$(echo "$ios_section" | rg -n -F -m1 -- "$SANITIZE_SCRIPT" | cut -d: -f1)"
ios_upload_line="$(echo "$ios_section" | rg -n -F -m1 -- 'actions/upload-artifact' | cut -d: -f1)"
[[ -n "$ios_sanitize_line" && -n "$ios_upload_line" && "$ios_sanitize_line" -lt "$ios_upload_line" ]] \
  || { echo "FAIL: sanitize-mobsf-report.sh does not precede actions/upload-artifact in ios-dynamic-scan" >&2; exit 1; }

# --- User Story 3 (guardrails + runbook) assertions ---

# (a) manual-only trigger -- no push/pull_request/schedule anywhere in the file (FR-009).
assert_absent 'pull_request' "$workflow" 'FR-009 manual-only trigger' -F
assert_absent '^\s*push:' "$workflow" 'FR-009 manual-only trigger'
assert_absent '^\s*schedule:' "$workflow" 'FR-009 manual-only trigger'

# (b) both jobs carry the main-only ref guard (SEC-001).
ref_guard_count="$(rg -c -F -- "if: github.ref == 'refs/heads/main'" "$workflow")"
[[ "$ref_guard_count" -ge 2 ]] || { echo "expected >=2 ref guards, found $ref_guard_count" >&2; exit 1; }

# (c) this workflow only consumes already-built artifacts, never compiles source (FR-001).
assert_absent 'expo prebuild' "$workflow" 'FR-001 no source compilation' -F
assert_absent 'gradlew' "$workflow" 'FR-001 no source compilation' -F
assert_absent 'xcodebuild' "$workflow" 'FR-001 no source compilation' -F

# (d) no secret value is ever echoed/printed (FR-006, SEC-003).
assert_absent 'echo.*secrets\.' "$workflow" 'FR-006 no secret echo'
assert_absent 'echo.*CORELLIUM_API_TOKEN' "$workflow" 'SEC-003 no Corellium token echo'

# (e) sanitize-mobsf-report.sh precedes actions/upload-artifact everywhere in the file
#     (whole-file regression guard, in addition to the per-job checks above).
sanitize_count="$(rg -c -F -- "$SANITIZE_SCRIPT" "$workflow")"
upload_count="$(rg -c -F -- 'actions/upload-artifact' "$workflow")"
[[ "$sanitize_count" -ge 2 && "$upload_count" -ge 2 ]] \
  || { echo "expected >=2 sanitize calls and >=2 uploads, found $sanitize_count/$upload_count" >&2; exit 1; }

# (f) both jobs set retention-days: 14 (FR-011).
retention_count="$(rg -c -F -- 'retention-days: 14' "$workflow")"
[[ "$retention_count" -ge 2 ]] || { echo "expected >=2 retention-days: 14, found $retention_count" >&2; exit 1; }

# (g) an explicit exit-code/status branch fails the job on a non-pass coverage outcome, and
#     is never conditioned on the findings count alone (FR-010 vs. FR-004/FR-014/FR-016,
#     research.md R12).
enforce_count="$(rg -c -F -- 'COVERAGE_EXIT_CODE' "$workflow")"
[[ "$enforce_count" -ge 2 ]] || { echo "expected >=2 coverage-outcome enforcement blocks, found $enforce_count" >&2; exit 1; }
assert_absent 'findings_count.*!=.*0' "$workflow" 'FR-010 non-blocking on findings alone'

# (h) the Maestro CLI install references a pinned version and a checksum-verification
#     command, not an unpinned "latest" install (ADR 0016).
assert_absent 'get\.maestro\.mobile\.dev' "$workflow" 'ADR 0016 pinned Maestro install (no unpinned installer script)' -F
maestro_install_count="$(rg -c -F -- 'MAESTRO_ZIP_SHA256' "$workflow")"
[[ "$maestro_install_count" -ge 2 ]] || { echo "expected >=2 Maestro checksum-pinned installs, found $maestro_install_count" >&2; exit 1; }
sha256sum_check_count="$(rg -c -F -- 'sha256sum -c' "$workflow")"
[[ "$sha256sum_check_count" -ge 2 ]] || { echo "expected >=2 sha256sum -c checksum verifications, found $sha256sum_check_count" >&2; exit 1; }

# --- Runbook content (FR-012, FR-013) ---

[[ -f "$runbook" ]] || { echo "missing $runbook" >&2; exit 1; }

for needle in \
  'gh workflow run' \
  'ios_runner_label' \
  'network-allowlist.yml' \
  '14-day' \
  'cleanup' \
  'troubleshoot' \
  'rollback' \
  'not provisioned' \
  'baseline'
do
  rg -q -i -F -- "$needle" "$runbook"
done

echo "test-mobsf-dynamic-scan-workflow.sh: all assertions passed"
