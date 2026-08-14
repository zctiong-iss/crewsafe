# ADR 0016 — Maestro for mobile dynamic-scan UI automation

**Status:** Accepted
**Date:** 2026-08-13
**Jira:** SCRUM-350

## Context

SCRUM-350 establishes MobSF dynamic scanning for the Android and iOS artifacts already
produced by SCRUM-348's native build workflow. The dynamic scan must drive a deterministic
synthetic flow — app launch, sign-in against the real staging Cognito backend (via the
existing `cognito-password` auth mode, `mobile/README.md`), one authenticated API call, an
acknowledgement action, and sign-out — so MobSF can capture real runtime/network behaviour.

MobSF's own dynamic analyzer (Frida instrumentation, the Activity Tester) explores an app
automatically but cannot reliably complete a specific credentialed flow like sign-in; it is
built for fuzzing and passive capture, not scripted interaction. Something has to drive the
UI deterministically. No such tool exists anywhere in this repository today — `mobile/`
carries no Detox, Appium, Maestro, or WebdriverIO dependency (verified via `package.json`) —
so this is a genuinely new CI-tooling dependency, not a reuse of something already approved.

AGENTS.md §8 requires an ADR before adding any stack component outside the approved stack in
plan §10.3. Neither the Jira ticket nor the constitution names a specific UI-automation tool
(unlike MobSF and Corellium, which SCRUM-350's own description explicitly authorizes), so this
choice needed its own review rather than being folded silently into the feature's plan.

Three options were evaluated:

1. **Maestro** — a single-binary CLI, YAML flow files, no server process to run in CI.
   Officially supports both Android emulators (via ADB) and iOS simulators/devices,
   matching this feature's two-platform scope.
2. **Raw ADB/idb input commands** (`adb shell input tap/text`) — zero new dependency, but
   coordinate-based and brittle: any layout change, screen-size difference, or timing shift
   breaks the script silently, which directly undermines the coverage/liveness signal
   (spec.md FR-016) this feature depends on to distinguish a genuine scan from a broken one.
3. **Appium** — the long-established WebDriver-protocol tool. More capable than Maestro but
   requires running an Appium server plus platform-specific drivers as additional CI
   processes; more moving parts to install, pin, and maintain for a flow this small.

## Decision

Use **Maestro** to script and drive the synthetic mobile flow in the dynamic-scan workflow.
Flow files live under version control (`.github/security/mobsf-dynamic/flows/`) as reviewable
YAML, one per platform where the two diverge. Maestro's own step-by-step pass/fail result is
also the coverage/liveness signal required by FR-016 — if a step (e.g., the sign-in button, an
authenticated-screen element, the sign-out confirmation) is not found, the flow itself fails,
independent of what MobSF's report says.

## Rationale

- **Matches the actual need.** This feature needs one short, fixed flow run non-interactively
  in CI, not a general-purpose test-automation platform. Maestro's flow-file model is the
  smallest tool that reliably does that on both platforms.
- **Lower CI footprint than Appium.** No server process, no driver matrix to install and pin;
  a single downloaded CLI binary, consistent with how this repo already pins tools by
  version/digest (`install-scanners.sh`, action SHA pins).
- **More reliable than raw ADB/idb.** Maestro's built-in waits, retries, and element-based
  (not coordinate-based) selectors are materially less flaky than hand-rolled `input tap`
  sequences, which matters because a flaky driver would make FR-016's "no coverage evidence →
  fail" rule fire on false negatives.

## Consequences

- One new CI-tooling dependency to install and pin (by release version, verified checksum) in
  the new dynamic-scan workflow — installed fresh per job run, not vendored into `mobile/`,
  so it carries no application dependency-tree or bundle-size impact.
- Flow files are a new artifact class to review and keep in sync with the app's UI whenever a
  screen touched by the synthetic flow changes; a broken flow now fails the dynamic-scan job
  closed (by design, per FR-016) rather than silently.
- Maestro is scoped strictly to this CI workflow — it is not proposed as a general mobile
  end-to-end testing solution for `mobile/`'s own test suite, which is out of scope for
  SCRUM-350.

## Alternatives rejected

- **Raw ADB/idb input commands.** Rejected: no new dependency, but coordinate-based scripts
  are too brittle for a signal (FR-016) this feature treats as security-relevant, and offer no
  built-in wait/retry primitives.
- **Appium.** Rejected: capable, but its server-plus-drivers footprint is disproportionate to
  a single fixed five-step flow, and it would be a heavier addition to review and maintain
  than the flow-file-only Maestro CLI.
