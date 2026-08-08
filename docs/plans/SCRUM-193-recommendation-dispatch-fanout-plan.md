# SCRUM-193 — Fan out an approved recommendation to per-worker action dispatches

## Outcome

Approving (or editing-and-approving) a recommendation now automatically creates one
`ActionDispatch` per worker assigned to the shift, per mitigation in the plan that was
actually approved — closing the gap found while building SCRUM-119 and SCRUM-184:
`ActionDispatchService.dispatchAction` already required an `Approval` with a real decision
before it would create anything, but nothing before this ticket could ever produce one
automatically. A supervisor's decision now reaches a worker's pending-dispatch inbox with
no manual `POST /api/action-dispatch` call required, matching this ticket's acceptance
criteria exactly.

## Approved design

- **Fires from `RecommendationService.decide`**, not a separate endpoint or a step the
  supervisor triggers by hand — the ticket's acceptance criteria state plainly that no
  manual call should be required.
- **Runs after the decision commits**, in the same deferred `afterCommit` callback the
  audit write already uses, not inside the decision's own transaction. Reason: a dispatch
  failing to create for one worker must never undo a supervisor's already-recorded
  decision — the decision and the notification of it are two different guarantees, and
  coupling them into one all-or-nothing transaction would let a mechanical
  dispatch problem quietly erase a real human decision.
- **A shift with no assigned workers dispatches nothing and is not an error** — the
  decision itself still succeeds; there's simply no one to notify yet.
- **Every mitigation goes to every worker on the shift.** No per-worker targeting exists
  on a mitigation yet (SCRUM-243, filed alongside this ticket, not built) — this is a
  known, documented limitation, not an oversight. Once SCRUM-243 lands, this fan-out
  should be revisited to respect it instead of broadcasting to the whole shift.
- **`actionCode` is a fixed placeholder**, `AI_RECOMMENDED_ACTION`, for every dispatch
  created this way. A mitigation is currently free text (`action`, `rationale`,
  `estimatedImpact`) with no short code of its own — unlike the deterministic policy
  engine's `PolicyAction.code` (`REST_10_MIN_HOURLY`, `HYDRATE_HOURLY`, ...). The
  mitigation's `action` text becomes the dispatch's `instruction` instead, so nothing is
  lost — a worker still sees the actual guidance — but every AI-sourced dispatch currently
  renders identically from a UI-categorization standpoint. Giving mitigations their own
  action codes would be a natural follow-up alongside SCRUM-243, not solved here.

## What was built

- `ActionDispatchService.dispatchAction` — the "must be an APPROVED decision" guard now
  reads "must not be REJECTED", so an EDITED decision (approved, with changes) can be
  dispatched too. Previously it could only ever be `APPROVED` exactly, which meant an
  edited-and-approved recommendation could never reach a worker at all through this
  method — a hard blocker for this ticket, fixed as part of it.
- `ActionDispatchService.dispatchAction` — propagation changed from the default
  (`REQUIRED`) to `REQUIRES_NEW`. See "A transaction bug found while building this" below
  — this was not optional, the feature did not work without it.
- `RecommendationService.decide` — after the existing audit-event `afterCommit`, a second
  `afterCommit` now calls a new private method, `fanOutDispatches`, whenever the decision
  is not a rejection.
- `RecommendationService.fanOutDispatches` (new) — looks up every worker currently
  assigned to the shift (`ShiftAssignmentRepository.findByShiftId`, deduplicated), and
  calls the existing `ActionDispatchService.dispatchAction` once per worker per mitigation
  in the approved plan (the original draft for a plain `APPROVED` decision, the edited
  list for `EDITED`).
- 4 new tests in `RecommendationControllerTest`: approving with two assigned workers
  creates one dispatch per worker (both correct action code and instruction text);
  rejecting creates none; editing dispatches the edited plan's text, not the original
  draft's; a shift with no assigned workers creates none and still returns 200.

## A transaction bug found while building this

`ActionDispatchService.dispatchAction` (called from `fanOutDispatches`, called from an
`afterCommit` callback) ran to completion and logged success for every worker, but no
`ActionDispatch` rows existed afterward. Root cause: `dispatchAction` was plain
`@Transactional` (default `REQUIRED` propagation). Spring's `afterCommit()` callback fires
*after* the physical database commit but *before* the transaction manager finishes
tearing down its synchronization bookkeeping — so a `REQUIRED`-propagation method called
from inside that callback finds synchronization still technically bound to the thread and
silently "joins" the tail end of the transaction that just finished, instead of opening a
genuinely new one. The writes run, but nothing durably commits them.

`AuditService.record` already avoids this exact trap with `REQUIRES_NEW`, which is
precisely why the audit-write-from-`afterCommit` pattern has worked reliably everywhere
else in this codebase. `dispatchAction` never needed that guarantee before, because its
only other caller is a plain controller method with no ambient transaction to collide
with — SCRUM-193 is the first caller to invoke it from a deferred context. Fixed by
switching `dispatchAction` to `REQUIRES_NEW` as well. Verified harmless for its existing
caller: with no ambient transaction there in the first place, `REQUIRED` and
`REQUIRES_NEW` behave identically.

## Dependencies

- **Built on**: SCRUM-119 (`RecommendationService`/`decide`, same PR — this shipped as an
  addition to that branch rather than a separate one, since it edits the exact method
  SCRUM-119 introduced and needs it to exist first).
- **Related**: SCRUM-243 (per-worker targeting on a mitigation) — filed as a direct
  follow-up to the "every mitigation to every worker" limitation documented above.

## Verification

Full backend suite: 188/188 passing, no regressions.
