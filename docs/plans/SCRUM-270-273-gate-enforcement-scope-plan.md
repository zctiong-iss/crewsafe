# SCRUM-269 / SCRUM-270 / SCRUM-273 — gate enforcement scope for Sprint 2

## Decision

SCRUM-269 (dependency and container vulnerability scans), SCRUM-270
(container image scan gate), and SCRUM-273 (authenticated DAST for staging)
ship in Sprint 2 (US-27, SCRUM-145) as **skeleton mechanisms only**: the
pipeline plumbing is built and findings are visible, but none of the three
gates blocks a release on what it finds yet.

SCRUM-269 already shipped this way in practice — its backend Trivy scan is
report-only (`exit-code: '0'`) and its SonarCloud SCA Quality Gate condition
is scoped to New Code only, leaving a known, untriaged backlog (120
dependency risks confirmed live on 2026-08-09) unblocked (see
`docs/runbooks/SCRUM-269-ci-vulnerability-scan-gates.md` §1–§2). This plan
formalizes that as the deliberate template for SCRUM-270 and SCRUM-273, and
retargets SCRUM-269's own follow-up tracking from a generic "Jira issue
under SCRUM-145" to **SCRUM-146** specifically, so all three gates' blocking
flips are tracked in one place: the sprint whose acceptance criterion is
"no unresolved high/critical."

| Subtask | Sprint 2 scope | Deferred to Sprint 3 (SCRUM-146) |
|---|---|---|
| **SCRUM-269** Dependency and container vulnerability scans in CI | Already shipped report-only: backend Trivy scan (`exit-code: '0'`), SCA Quality Gate condition scoped to New Code only | Flip backend Trivy to blocking (FR-001a); burn down the 120-item pre-existing SCA backlog, then widen the Quality Gate condition beyond New Code |
| **SCRUM-270** Build and publish only scan-approved container images | Build, tag (commit SHA), scan (Trivy), and push for both images; capture and surface the digest (currently missing on the backend side — see below); findings visible in the job summary | Flip the scan step(s) from report-only to blocking; triage/except the pre-existing findings backlog first |
| **SCRUM-273** Authenticated DAST scanning for staging | Wire the authenticated DAST scan against the deployed staging release; publish findings for review; document scope/exclusions | Set the "configured blocking severity" to actually prevent promotion; triage/except the initial findings backlog first |

## Why this split, not immediate enforcement

Both tickets' acceptance criteria use blocking language on their face
("do not publish a deployable release image," "prevents promotion"). Taken
literally, that would mean *fixing* whatever the scanners find before either
ticket could close — which is exactly the work SCRUM-146 (US-28, "Security
testing suite and remediation evidence") exists to own: its acceptance
criterion is explicitly "findings, severity, remediation and re-test
documented; no unresolved high/critical." Building the enforcement mechanism
and burning down an unknown findings backlog are different kinds of work;
conflating them in Sprint 2 would mean quietly doing Sprint 3 scope early
with no dedicated tracking for it.

**Required follow-up** (do not flip either gate silently as part of an
unrelated change): once the report-only period's findings are triaged for
each gate — a fix applied, or a reviewed, time-bounded exception recorded —
flip:

- `backend-ci.yml` / whichever workflow SCRUM-270 lands the image gate in:
  scan step from report-only to blocking (mirrors the existing SCRUM-269 §1
  follow-up, which is still open for the pre-existing backend Trivy scan).
- The DAST workflow SCRUM-273 adds: blocking-severity threshold from
  advisory to enforced.

File both as explicit Jira subtasks under SCRUM-146 when that sprint is
scoped, rather than treating the flip as implied by SCRUM-270/273 existing.

## Consequence: neither ticket can close as Done at Sprint 2's end

Per the constitution's Definition of Done (`AGENTS.md` §3 / plan §17.3), a
story does not move to Done with an unreviewed high-severity finding — and a
report-only gate means findings are, by definition, unreviewed at release
time. Under this plan, SCRUM-270 and SCRUM-273 should either:

- stay open, carried into Sprint 3, and closed only once flipped to
  blocking; or
- be split into two tracked pieces each (mechanism vs. enforcement), so the
  Sprint 2 board accurately shows "pipeline built" without implying "gate
  enforced."

Recommend the split-ticket approach so Sprint 2 velocity reporting isn't
distorted by carrying large tickets across the sprint boundary. Either way,
do not transition SCRUM-270 or SCRUM-273 to Done in Sprint 2 under this plan.

## Known limitation: SCRUM-271 (automate deployment to staging)

SCRUM-271's acceptance criteria include "a release that passes required
gates is automatically deployed to staging" and "the deployment uses the
approved immutable image reference." SCRUM-271 itself has no vulnerability
backlog to triage — "failed deployment" is an infra-correctness check, not a
security-severity judgment — so it can and should be built fully enforced in
Sprint 2.

**However**, while SCRUM-270 and SCRUM-273 remain report-only:

- Every release that reaches `publish-image` will be pushed and deployed to
  staging **regardless of container-scan or DAST findings**. The "only after
  required gates pass" language in SCRUM-271's scope is not a real
  constraint during this window — it degenerates to "after tests pass and
  the image builds," since the security gates it depends on don't yet fail
  anything.
- This is not a defect in SCRUM-271's own implementation; it is a direct,
  intentional consequence of the SCRUM-270/273 scope decision above, and it
  self-resolves the moment those two gates flip to blocking in Sprint 3.
- Do not word SCRUM-271's Done criteria or any status update as "staging
  only receives scan-approved releases" until SCRUM-270 and SCRUM-273 are
  both blocking — until then, the accurate description is "staging receives
  releases that passed build/test and were built successfully; scan and DAST
  findings are visible but not yet enforced."

Track this limitation in the SCRUM-271 implementation's own documentation
(runbook or workflow comments, matching the SCRUM-269 §1 pattern) once that
ticket is implemented, not only here.

## Related

- `docs/runbooks/SCRUM-269-ci-vulnerability-scan-gates.md` — the precedent
  this plan follows (backend Trivy report-only rollout).
- SCRUM-145 (US-27) — parent story; SCRUM-146 (US-28) — the remediation-
  evidence story this plan defers enforcement work into.
