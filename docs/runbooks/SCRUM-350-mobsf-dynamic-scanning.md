# SCRUM-350 — MobSF Dynamic Scanning Runbook

**Workflow:** `.github/workflows/mobsf-dynamic-scan.yml`
**Repository:** `zctiong-iss/crewsafe`
**Purpose:** internal security testing only — runs MobSF dynamic analysis against an
already-built Android or iOS artifact from `mobile-native-build.yml` (SCRUM-348), driving a
synthetic sign-in/API-call/acknowledgement/sign-out flow with Maestro. Findings are recorded
as CI evidence and do **not** block anything in this iteration (§7 explains why, and what
will change that later).

## 1. Prerequisites

- A `mobile-native-build.yml` artifact built with `auth_mode=cognito-password`, so it
  authenticates against the real staging backend instead of `mock` fixtures:

  ```bash
  gh workflow run mobile-native-build.yml \
    --ref main \
    -f ios_profile=simulator \
    -f auth_mode=cognito-password
  ```

  Note the run ID (`gh run list --workflow=mobile-native-build.yml --limit 1`) — this
  workflow needs it as `source_run_id`.
- The synthetic worker account (`demo-worker`, `.github/cognito/synthetic-users.yml`) has at
  least one pending action-dispatch item seeded in staging, so the flow's Acknowledge step has
  something to tap. Seed one the same way any other synthetic-worker test data is seeded for
  that account/site (`bishan`) — there is no dedicated seeding step in this workflow itself.
- Repository variables/secrets this workflow reuses from `dast-staging.yml` — already
  provisioned, nothing new to set up: `vars.CREWSAFE_BACKEND_BASE_URL`,
  `vars.CREWSAFE_DAST_SYNTHETIC_WORKER_USERNAME`, `secrets.DAST_SYNTHETIC_WORKER_PASSWORD`.

## 2. Trigger

Manual `workflow_dispatch` only — this workflow never runs on `push`, an opened/updated pull
request, or a schedule. Both jobs additionally require `github.ref == 'refs/heads/main'`, so a
dispatch against any other ref accepts but no-ops. Anyone with `workflow_dispatch` permission
on this repository (write access or higher) can trigger it; external contributors and PR
forks cannot reach it at all.

```bash
gh workflow run mobsf-dynamic-scan.yml \
  --ref main \
  -f source_run_id=<run-id-from-step-1>
```

Add `-f ios_runner_label=<label>` only if a self-hosted physical-device runner is registered
(§5) — leave it unset/empty otherwise, which is the default and what routes the iOS job to
`ubuntu-latest`.

## 3. Device/analyzer provisioning

- **Android**: nothing to provision — `reactivecircus/android-emulator-runner` boots a fresh
  emulator on the `ubuntu-latest` runner for every run automatically. MobSF's own container is
  started with `ANALYZER_IDENTIFIER=emulator-5554` so it targets that emulator unambiguously
  (verified against MobSF's source, `mobsf.MobSF.utils.get_device()`).
- **iOS — Corellium** (the default path when `ios_runner_label` is left empty): provision
  `vars.MOBSF_CORELLIUM_API_DOMAIN`, `secrets.MOBSF_CORELLIUM_API_KEY`, and
  `vars.MOBSF_CORELLIUM_PROJECT_ID` (optional). These are **MobSF's own** environment variable
  names (verified against `mobsf/MobSF/settings.py` in MobSF's source) — this workflow never
  calls Corellium's API directly, only MobSF's own `/api/v1/ios/corellium_*` endpoints, so
  these three vars are passed straight into the MobSF container. See §6 for the Solo-tier
  capability caveat, and the important architectural gap below it, before treating this path
  as production-ready.
- **iOS — physical signed device**: register a self-hosted GitHub Actions runner attached to a
  provisioned, **jailbroken** device with SSH access (MobSF's own iOS-device dynamic-analysis
  module is documented as "iOS Jailbroken Device" — a merely signed, non-jailbroken device is
  not sufficient for this path), with `libimobiledevice` (`idevice_id`) installed for the
  availability check. Set `vars.IOS_DEVICE_UDID` to that device's UDID. Dispatch with
  `-f ios_runner_label=<that runner's label>` to route the job there — leaving it unset routes
  to `ubuntu-latest`, which can never reach a physical device (GitHub Actions resolves
  `runs-on:` before the job starts; see `check-ios-analyzer-availability.sh`'s header).

## 4. Downloading and reading the report

```bash
gh run watch --exit-status
gh run download <run-id> -n mobsf-dynamic-android-<commit-sha>
gh run download <run-id> -n mobsf-dynamic-ios-<commit-sha>
```

Each download contains `mobsf-report.json` (sanitized), `network-findings.json`,
`maestro-run.log` (sanitized), and `dynamic-scan-metadata.json` (platform, commit SHA,
artifact hash, analyzer environment, outcome, run ID, triggered-by). The same fields are also
written into the run's job summary.

## 5. iOS — expected to fail until provisioned

**Neither Corellium nor a physical device is provisioned for this project today.** Every
real dispatch is expected to fail at the "Check iOS analyzer availability" step with an
explicit `iOS dynamic analyzer environment is not provisioned` error — this is correct,
tested behavior (spec.md Clarifications: "scaffold now, provision later"), not a bug. Android
dynamic scanning is unaffected and delivers full value independently.

Once Corellium credentials *are* provisioned, dispatches will get further — the availability
check passes, and the "Provision Corellium instance" step genuinely creates/starts a Corellium
instance and installs the app — but will then still fail **on purpose** with an explicit error
at that same step, because Maestro cannot drive a Corellium instance (§6's architectural gap).
This is also correct, tested behavior, not a regression to chase, until that gap is closed.

## 6. Network allowlist

`.github/security/mobsf-dynamic/network-allowlist.yml` lists the hostnames the synthetic flow
may legitimately contact — today, the staging backend host and Cognito's Hosted UI domain. A
connection outside this list is **recorded** in `network-findings.json`, never blocked (a
mid-flow network block would abort the scripted flow and produce a false
`no-coverage-evidence` failure). To add or change an entry, edit the `allowed_hosts:` list in
a reviewed PR — `*` matches any subdomain segment (bash glob matching).

**Corellium Solo capability caveat**: the Solo plan includes only the "Essential Testing
Toolkit" and cloud-service deployment only. Once trial access is granted, verify before
relying on the Corellium path in production: (a) API-driven non-interactive device
boot/install/launch/teardown suitable for unattended CI, (b) Frida-capable dynamic
instrumentation for MobSF to hook into, (c) a way to export captured network traffic for
`check-network-allowlist.sh` to inspect. Record the outcome here (including any
concurrency/session-time limits found, which could affect the 45-minute run bound in §7) once
verified.

**Known architectural gap — Corellium's path cannot run the synthetic flow yet.** Verified
against MobSF's own source (`mobsf/DynamicAnalyzer/views/ios/corellium_instance.py`): MobSF
talks to a Corellium instance exclusively over **SSH** (`CorelliumInstanceAPI`/
`CorelliumAgentAPI`), never over idb/USB — the channel Maestro requires. The workflow's
`android-dynamic-scan`-equivalent Corellium branch (`ios-dynamic-scan`, `Provision Corellium
instance` step) genuinely creates and starts the instance and installs the app through MobSF's
real API — that part works — but then fails **explicitly and on purpose** rather than
attempting `maestro test` against a target it cannot reach. Closing this gap needs one of:
(a) Corellium's own device-network-exposure feature, if the account tier supports it
(unverified for Solo), or (b) re-driving the five-step flow through MobSF's own SSH/tap
primitives instead of Maestro. Neither is implemented in this iteration — this is scoped as
future work, not a bug to chase. Until then, only the `ios-signed-device` path (a real
USB-attached jailbroken device, which Maestro reaches directly and independently of MobSF's
SSH channel) can complete the synthetic flow end to end on iOS.

## 7. Non-blocking today, and what changes later

Findings from this workflow **do not** fail a run — only these do: the analyzer/device was
unavailable, MobSF or Maestro crashed, or the synthetic flow produced no coverage/liveness
evidence (a well-formed report with zero findings and no proof the flow actually ran). This
keeps the workflow non-blocking while the analyzer environment (especially the iOS path) is
still being stabilized, per spec.md FR-010.

**Future blocking threshold and baseline process** (FR-013, not implemented in this
iteration): once the analyzer environment has been stable in production for a reasonable
period, a follow-up feature will introduce a reviewed severity gate — new HIGH/CRITICAL
findings block, existing findings are baseline-managed with an owner and expiry, mirroring
`.github/security/sca-exceptions.yml`'s existing owner/expiry-based shape. That follow-up
decides the actual severity threshold and baseline-approval workflow; this runbook only
records that the decision is deliberately deferred, not that it is undefined.

## 8. Cleanup

Nothing to clean up manually after a normal run: the MobSF container is started with
`docker run -d --rm`, so it is removed automatically when it stops; the Android emulator is
torn down with the runner VM at job end; uploaded artifacts expire automatically after 14
days (§9). If a run is cancelled mid-scan, the MobSF container may be left running until the
runner VM itself is recycled by GitHub Actions — this self-resolves and needs no manual
action.

### Rollback of a broken analyzer environment

- **Android (GitHub-hosted emulator)**: nothing to roll back — every run boots a fresh
  emulator on a fresh runner VM, so there is no persistent state to restore. Re-dispatch.
- **iOS — Corellium**: if a Corellium project/instance is left in a bad state, delete and
  recreate the instance from Corellium's own console/API (standard Corellium project
  operations, not something this workflow manages) — this workflow provisions no persistent
  Corellium state of its own to roll back.
- **iOS — physical signed device (self-hosted runner)**: this is the one path with real
  persistent state to recover. If the device or its host runner is left broken (device
  unresponsive, stale pairing, corrupted install), the known-good recovery is: restart the
  device, re-run `idevicepair pair` if "Trust This Computer" needs re-accepting, restart the
  `actions-runner` service on the host, and re-run
  `.github/scripts/tests/test-check-ios-analyzer-availability.sh`'s live equivalent (a real
  `idevice_id -l` check) to confirm the UDID is visible again before re-dispatching against
  that `ios_runner_label`.

## 9. Retention and access

Every uploaded report (Android and iOS) uses a 14-day retention period and then automatically
expires — there is no manual cleanup step. While a report exists, who can access it is
governed by GitHub Actions' standard artifact-access model: repository collaborators with
read access to this repository can download workflow artifacts from its Actions runs.

## 10. Failure and recovery (troubleshooting)

| State | Safe response |
|---|---|
| Android emulator does not boot within 10 minutes | Job fails at the "Boot Android emulator" step (FR-004). Re-run; if it recurs, check `reactivecircus/android-emulator-runner`'s own status/incidents before assuming a local misconfiguration. |
| iOS analyzer unavailable | Expected until §3/§5's provisioning is complete; use the Android path in the meantime. |
| iOS Corellium instance provisions successfully, then the job fails at "Provision Corellium instance" | Expected — §6's Maestro/Corellium architectural gap, not a bug. Use the `ios-signed-device` path (a real jailbroken USB device) for a complete iOS run in the meantime. |
| MobSF container fails to start or never becomes ready | Job fails at "Start MobSF service" with a clear message (`start-mobsf-service.sh`). Re-run; if it recurs, confirm the pinned `MOBSF_IMAGE` digest still resolves (a deleted/moved image tag would need a new digest pinned in the workflow). |
| Maestro flow fails partway (e.g. a UI element not found) | Job fails with `outcome: no-coverage-evidence` (FR-016) — this is the intended fail-closed behavior when the synthetic flow cannot be proven to have run. Check `maestro-run.log` in the uploaded report; if the app's UI has changed (e.g. relabeled buttons), update `.github/scripts/mobsf-dynamic/flows/synthetic-flow.*.yaml` in a reviewed PR. |
| Zero findings with no coverage evidence | Same as above — never treated as a clean pass (SC-003). |
| Sanitization cannot confirm all secrets were stripped | Job fails at "Sanitize MobSF report"; nothing is uploaded (SEC-003). This should not happen in normal operation — if it does, treat it as a real finding about the redaction patterns needing an update, not a transient failure to retry past. |
| Dispatch against a non-`main` ref | Both jobs no-op by design (the `main`-only ref guard); rerun against `main`. |
| Runner/provider outage (GitHub-hosted or self-hosted) | Leave the failure visible, then retry after service recovery. |

Never weaken the `workflow_dispatch`-only trigger, add a `push`/`pull_request`/`schedule`
trigger, or make findings alone fail the job — all three are enforced by
`test-mobsf-dynamic-scan-workflow.sh` and will fail CI.

## 11. Local validation

```bash
.github/scripts/tests/test-mobsf-dynamic-scan-workflow.sh
.github/scripts/tests/test-retrieve-and-verify-artifact.sh
.github/scripts/tests/test-check-network-allowlist.sh
.github/scripts/tests/test-evaluate-coverage-signal.sh
.github/scripts/tests/test-sanitize-mobsf-report.sh
.github/scripts/tests/test-start-mobsf-service.sh
.github/scripts/tests/test-check-ios-analyzer-availability.sh
.github/scripts/tests/test-mobile-native-build-workflow.sh
```

None of these need Android/iOS toolchains, an emulator, a physical device, Corellium access,
or Docker — all are pure structural/executed-script checks against fixtures or a stubbed
`docker`/`curl`/`idevice_id`. See `quickstart.md` (`specs/036-mobsf-dynamic-scanning/`) for
the live end-to-end validation steps this runbook's guardrails complement.
