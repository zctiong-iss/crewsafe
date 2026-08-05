# SCRUM-184 — Action dispatch and acknowledgement contract, incl. idempotency semantics

## Outcome

`docs/api/action-dispatch.yaml` — a committed OpenAPI contract for the six
`/api/action-dispatch/...` endpoints. Written **after** the fact: `ActionDispatchController`
(SCRUM-185) and the mobile inbox (SCRUM-186) were both already built and shipped without
this spec existing. This documents what they actually do today rather than a fresh
design — the opposite direction from every other contract in this repo, where the YAML
shipped first and the code was built to match it.

## Why backward, not forward

SCRUM-184 was meant to come first ("Do this first. Blocks the backend and mobile halves
of SCRUM-124.") but SCRUM-185 and the mobile inbox were already built and marked Done by
the time this was picked up. Re-litigating the design at this point would mean asking the
backend and mobile owners to change already-shipped, already-working code to match a
spec written after the fact for no functional reason — worse than documenting reality and
flagging the gaps found along the way, which is what this does instead.

## What was verified against the real implementation

- **Dispatch payload schema** — `ActionDispatchResponse.java` field for field:
  `id`, `approvalId`, `workerId`, `actionCode`, `instruction`, `startTime`, `endTime`,
  `status`, `dispatchedAt`.
- **Acknowledgement idempotency** — `ActionDispatchService.acknowledgeDispatch` returns
  early (before any write) when the dispatch is already `ACKNOWLEDGED`. This satisfies
  SCRUM-184's literal acceptance criterion — "200 with the original result, not a 409" —
  today, but via a **status check**, not by looking up the `Idempotency-Key` header's
  value. The header is still required on every request: state-based idempotency only
  works while the client is asking about a dispatch row that still exists in the state
  it remembers, and an offline queue replaying a write long after the fact (possibly
  across a reinstall) needs a key generated and persisted at the moment of the original
  tap. Confirmed the mobile client (`mobile/src/api/endpoints/dispatch.ts`) already sends
  this header on every attempt for exactly this reason, and that it is on the backend's
  CORS allow-list (`SecurityConfig`) even though nothing reads its value yet.
- **Targeting rule** — a dispatch always names one `workerId`; there is no fan-out
  endpoint. `acknowledgeDispatch`/`completeDispatch` check `dispatch.getWorker().getId()
  .equals(principal.getId())` and 403 (not 404) a mismatch — enumerating valid-but-not-
  mine dispatch ids via a 404/403 split was worth avoiding. `getPendingDispatchesForWorker`
  checks the path `workerId` against the caller the same way.
- **Retry contract** — written down explicitly in the YAML: same `dispatchId`, same
  `Idempotency-Key`, expect 200 with the prior result, never a second record.

## Two gaps found while writing this, not fixed here

Contract-only ticket; both are backend behaviour changes, out of scope for this PR.

1. **`GET /api/action-dispatch/{dispatchId}` has no worker-ownership check.** Unlike
   acknowledge, complete, and the pending-list, a `WORKER` caller can read any dispatch by
   id, not only their own. Noted in the contract's description for that path rather than
   silently normalized away or fixed.
2. **`ActionDispatchService` throws plain `IllegalArgumentException`** for "Approval not
   found", "Worker not found", "ActionDispatch not found" and "Can only dispatch from an
   approved decision" — none of which `GlobalExceptionHandler` has a handler for. All four
   currently fall through to the catch-all and return 500, not 400/404. A client sending a
   typo'd `approvalId` sees a server error, not a validation error. Flagged, not fixed —
   this is `ActionDispatchService`'s error handling, not this contract ticket's scope.

## Dependencies

- **Built on top of**: SCRUM-185 (`ActionDispatchController`/`ActionDispatchService`,
  already merged) and SCRUM-186 (mobile inbox, already merged).
- **Blocks**: nothing further in SCRUM-124 — the backend and mobile halves are both
  already done; this closes out the paperwork the epic's dependency chain called for.
