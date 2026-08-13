# SCRUM-348 — Mobile Native Security-Test Artifacts Runbook

**Workflow:** `.github/workflows/mobile-native-build.yml`
**Repository:** `zctiong-iss/crewsafe`
**Purpose:** internal security testing (MobSF) and QA only. **Never** for Google Play, the
Apple App Store, or TestFlight — no such step exists in this workflow, and a structural test
(`test-mobile-native-build-workflow.sh`) fails the build if one is ever added.

## 1. Trigger

Manual `workflow_dispatch` only — this workflow never runs on `push` or `pull_request`. Every
job additionally requires `github.ref == 'refs/heads/main'`, so a dispatch against any other
ref accepts but no-ops. Anyone with `workflow_dispatch` permission on this repository
(write access or higher) can trigger it; external contributors and PR forks cannot reach it at
all.

Trigger a build:

```bash
gh workflow run mobile-native-build.yml \
  --ref main \
  -f ios_profile=simulator \
  -f build_android_aab=false
```

`ios_profile` is `simulator` (default) or `adhoc`. `build_android_aab` is `true`/`false`
(default `false` — an APK is always produced regardless).

Or use the Actions tab in the GitHub UI: **Actions → Mobile Native Build → Run workflow**,
select `main`, and set the two inputs.

## 2. Downloading artifacts

```bash
gh run watch --exit-status
gh run download <run-id> -n mobile-android-apk-<commit-sha>
gh run download <run-id> -n mobile-ios-simulator-<commit-sha>   # or mobile-ios-adhoc-<commit-sha>
```

Each download contains the binary plus `artifact-metadata.json` (platform, artifact_type,
build_profile, app_version, commit_sha, run_id, run_url, triggered_by). The same fields are
also written into the run's job summary, so a reviewer can trace provenance without
downloading anything.

## 3. Using the Android APK with MobSF

The APK is debug-signed (no custom keystore, no GitHub secret) — this is a deliberate choice:
MobSF and internal test installs both work with a debug-signed build, and it avoids
introducing Android signing infrastructure this feature doesn't need.

```bash
adb install mobile-android-apk-<commit-sha>/app-debug.apk
```

Load the same `.apk` into MobSF (Upload & Scan). It is accepted as a standard analyzable
Android binary.

## 4. Using the iOS Simulator app

```bash
xcrun simctl install booted mobile-ios-simulator-<commit-sha>/*.app
xcrun simctl launch booted sg.crewsafe.mobile
```

The Simulator `.app` never requires distribution signing — this is the default and complete
iOS deliverable for this feature today.

## 5. The `adhoc` iOS profile — expected to fail until Apple signing material exists

**This project has no Apple Developer account and no ad-hoc/internal-distribution
certificates yet.** Dispatching with `ios_profile=adhoc` is expected to fail at the "Check
Apple ad-hoc signing material" step with an explicit `Apple ad-hoc signing material is not
configured` error — this is correct, tested behavior (spec.md Clarifications), not a bug.

To unblock the `adhoc` profile in the future, provision these repository secrets (never
commit them, never print them in logs):

| Secret | Contents |
|---|---|
| `APPLE_DIST_CERTIFICATE_P12` | Base64-encoded ad-hoc/internal-distribution `.p12` certificate |
| `APPLE_DIST_CERTIFICATE_PASSWORD` | The `.p12` file's export password |
| `APPLE_PROVISIONING_PROFILE` | Base64-encoded `.mobileprovision` file matching the certificate and `sg.crewsafe.mobile` |
| `APPLE_TEAM_ID` | The Apple Developer Team ID the certificate/profile belong to |

Once all four are set, the same `ios_profile=adhoc` dispatch imports the certificate into a
temporary keychain, installs the provisioning profile, archives, and exports an ad-hoc IPA —
no workflow changes are required.

## 6. Retention and access

Every artifact (APK, AAB if built, Simulator `.app`, ad-hoc IPA) is uploaded with a 14-day
retention period and then automatically expires — there is no manual cleanup step. While an
artifact exists, who can access it is governed by GitHub Actions' standard artifact-access
model: repository collaborators with read access to this repository can download workflow
artifacts from its Actions runs. No separate distribution channel (Firebase App Distribution,
TestFlight internal testing, or similar) is used.

## 7. Failure and recovery

| State | Safe response |
|---|---|
| Android/iOS native compile failure | Fix the source issue; no partial artifact is uploaded for the failed platform, the other platform's job is unaffected. |
| `adhoc` profile fails at the signing-material check | Expected until §5's four secrets are provisioned; use `ios_profile=simulator` in the meantime. |
| Dispatch against a non-`main` ref | Both jobs no-op by design (the `main`-only ref guard); rerun against `main`. |
| Artifact expired (past 14 days) | Re-trigger the workflow for the same commit; a new artifact carries the same `commit_sha` in its metadata. |
| Runner/provider outage | Leave the failure visible, then retry after service recovery. |

Never weaken the `main`-only ref guard, add a `push`/`pull_request` trigger, or add a store
submission/publish step as a workaround — all three are enforced by
`test-mobile-native-build-workflow.sh` and will fail CI.

## 8. Local validation

```bash
.github/scripts/tests/test-mobile-native-build-workflow.sh
.github/scripts/tests/test-mobile-artifact-metadata.sh
```

Neither test needs Android/iOS toolchains, an emulator, or a simulator — both are pure
structural/executed-script checks. See
`specs/035-mobile-security-test-artifacts/quickstart.md` for the full live-dispatch
validation sequence (real build, MobSF ingestion, simulator boot, ad-hoc fail-closed check).
