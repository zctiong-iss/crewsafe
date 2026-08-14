#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../../.." && pwd)"
workflow="$root/.github/workflows/mobile-native-build.yml"
runbook="$root/docs/runbooks/SCRUM-348-mobile-native-security-artifacts.md"

# A bare `! rg -q ...` does not trigger errexit on match (SC2251 -- POSIX excludes commands
# whose exit status is inverted by `!` from the set -e failure list), so every "must not
# contain" assertion below goes through this helper instead.
assert_absent() {
  local pattern="$1" file="$2" label="$3"
  shift 3
  if rg -q "$@" -- "$pattern" "$file"; then
    echo "FAIL: found forbidden pattern ($label): $pattern" >&2
    exit 1
  fi
}

# --- Foundational assertions (T003 covers the metadata script itself in its own test file) ---

# --- User Story 1 (Android) assertions ---

for needle in \
  'node-version: "22.x"' \
  'distribution: temurin' \
  'java-version: "21"' \
  'expo prebuild --platform android' \
  './gradlew assembleDebug' \
  './gradlew bundleDebug' \
  'inputs.build_android_aab' \
  'write-artifact-metadata.sh' \
  'PLATFORM: android' \
  'retention-days: 14'
do
  rg -q -F -- "$needle" "$workflow"
done

# Locked-in debug-signing decision (research.md R5): no Android keystore/signing secret.
assert_absent 'secrets\.ANDROID_KEYSTORE|secrets\.ANDROID_KEY_ALIAS|secrets\.ANDROID_SIGNING' \
  "$workflow" 'FR-002/research.md R5 debug-signing' -i

# --- User Story 2 (iOS) assertions ---

for needle in \
  'expo prebuild --platform ios' \
  '-sdk iphonesimulator' \
  "inputs.ios_profile == 'simulator'" \
  "inputs.ios_profile == 'adhoc'" \
  'APPLE_DIST_CERTIFICATE_P12' \
  'APPLE_DIST_CERTIFICATE_PASSWORD' \
  'APPLE_PROVISIONING_PROFILE' \
  'APPLE_TEAM_ID' \
  'PLATFORM: ios'
do
  rg -q -F -- "$needle" "$workflow"
done

# The ad-hoc profile must fail closed (FR-008): an explicit non-empty check followed by exit
# 1 before any codesigning/xcodebuild archive step runs.
rg -q -F -- '-z "$APPLE_DIST_CERTIFICATE_P12"' "$workflow"
rg -q -F -- 'exit 1' "$workflow"

# --- User Story 3 (guardrails + runbook) assertions ---

# (a) manual-only trigger — no push/pull_request anywhere in the file.
assert_absent 'pull_request' "$workflow" 'FR-001 manual-only trigger' -F
assert_absent '^\s*push:' "$workflow" 'FR-001 manual-only trigger'

# (b) no store-submission/publish step ever exists (FR-009 regression guard).
assert_absent 'fastlane|testflight|App Store Connect|altool|transporter|play-publish|google-play|Google Play Console' \
  "$workflow" 'FR-009 no store submission' -i

# (c) no secret value is ever echoed/printed (FR-010).
assert_absent 'echo.*secrets\.' "$workflow" 'FR-010 no secret echo'

# (d) both jobs invoke the shared metadata script.
android_section="$(rg -A 500 -- '^  android-build:' "$workflow" | rg -B 500 -m1 -- '^  ios-build:' || true)"
ios_section="$(rg -A 500 -- '^  ios-build:' "$workflow")"
for section_name in android ios; do
  case "$section_name" in
    android) section="$android_section" ;;
    ios) section="$ios_section" ;;
  esac
  echo "$section" | rg -q -F -- 'write-artifact-metadata.sh'
done

# (e) both jobs carry the main-only ref guard (SEC-001).
ref_guard_count="$(rg -c -F -- "if: github.ref == 'refs/heads/main'" "$workflow")"
[[ "$ref_guard_count" -ge 2 ]] || { echo "expected >=2 ref guards, found $ref_guard_count" >&2; exit 1; }

# (f) both jobs' checkout is pinned to github.sha, never an interpolated ref (SEC-002).
checkout_pin_count="$(rg -c -F -- 'ref: ${{ github.sha }}' "$workflow")"
[[ "$checkout_pin_count" -ge 2 ]] || { echo "expected >=2 pinned checkouts, found $checkout_pin_count" >&2; exit 1; }
assert_absent 'github.head_ref' "$workflow" 'SEC-002 checkout pinning' -F

# (g) no continue-on-error (or equivalent) on the native build steps — a compile failure must
# propagate as a failed run (FR-007, FR-012).
assert_absent 'continue-on-error: true' "$workflow" 'FR-007/FR-012 fail-closed on compile failure' -F

test -f "$runbook" || { echo "missing $runbook" >&2; exit 1; }

for needle in \
  'gh workflow run' \
  'MobSF' \
  '14 day' \
  'who can access' \
  'ad-hoc' \
  'Apple' \
  'signing material'
do
  rg -q -i -F -- "$needle" "$runbook"
done

# --- SCRUM-350 auth_mode extension assertions (contracts/mobile-native-build-auth-mode-
#     extension.md — additive input for the mobsf-dynamic-scan.yml consumer) ---

rg -q -F -- 'auth_mode:' "$workflow"
auth_mode_block="$(rg -A10 -F -- 'auth_mode:' "$workflow")"
echo "$auth_mode_block" | rg -q -F -- 'type: choice'
echo "$auth_mode_block" | rg -q -F -- 'default: mock'
echo "$auth_mode_block" | rg -q -F -- 'cognito-password'

# The conditional step must exist in both jobs, gated on cognito-password, and persist the
# vars via $GITHUB_ENV (not a step-local `env:` block) so they remain visible through the
# later Gradle/xcodebuild step where Metro actually inlines EXPO_PUBLIC_* at bundle time —
# a step-local env: block would not reach that later step.
env_block_count="$(rg -c -F -- "if: \${{ inputs.auth_mode == 'cognito-password' }}" "$workflow")"
[[ "$env_block_count" -ge 2 ]] || { echo "expected >=2 auth_mode-gated blocks, found $env_block_count" >&2; exit 1; }
rg -q -F -- 'EXPO_PUBLIC_AUTH_MODE=cognito-password' "$workflow"
rg -q -F -- 'EXPO_PUBLIC_API_BASE_URL=${{ vars.CREWSAFE_BACKEND_BASE_URL }}' "$workflow"
rg -q -F -- '>> "$GITHUB_ENV"' "$workflow"

# The mock default path is structurally unchanged: every occurrence of the
# EXPO_PUBLIC_AUTH_MODE assignment must be gated the same number of times as the
# cognito-password `if:` condition appears — no bare/unconditional occurrence exists.
auth_mode_env_lines="$(rg -c -F -- 'EXPO_PUBLIC_AUTH_MODE=cognito-password' "$workflow")"
[[ "$auth_mode_env_lines" -eq "$env_block_count" ]] || {
  echo "FAIL: EXPO_PUBLIC_AUTH_MODE assignment count ($auth_mode_env_lines) does not match auth_mode-gated block count ($env_block_count) -- an unconditional occurrence may exist" >&2
  exit 1
}

echo "test-mobile-native-build-workflow.sh: all assertions passed"
