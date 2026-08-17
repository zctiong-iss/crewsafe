# SCRUM-TBD-70 — Auto-regenerating AI plans on the supervisor screen

**Status:** Implemented
**Branch:** `feat/scrum-tbd-70-auto-regenerating-plans`
**Related:** SCRUM-291 (auto-trigger), SCRUM-440 (auto-dispatch), SCRUM-441 (shift status scheduler)

---

## What this actually was

The ask was "auto-regenerate AI plans so nobody has to press Draft plan". The backend already
did that. [`RecommendationAutoTriggerScheduler`](../../backend/src/main/java/com/crewsafe/operation/service/RecommendationAutoTriggerScheduler.java)
drafts a plan on every WBGT band or lightning risk-state transition, every 2 minutes, with the
dedup, shift-state and STALE-freshness guards SCRUM-291 specified.

What was missing is that **the client never found out.** `RecommendationsScreen` fetched once
from a `useEffect` and otherwise waited for a supervisor to pull down. The auto-trigger worked;
nobody saw it.

So this was a surface-what-exists change, not a new AI feature — which is why it is small.

---

## Two decisions that will look arbitrary later

### 1. The client never asks the server to draft

The obvious implementation is to call `generateRecommendation` on a timer. It would have been
wrong twice over:

- **Cost.** Each call is a real 10–20 s model invocation. Every supervisor watching a site would
  produce their own draft for a single band change.
- **Correctness.** The dedup that makes a band change *supersede* the open plan rather than
  stack a second one lives in the scheduler, not behind the generate endpoint. Client-side
  triggering bypasses it, producing exactly the duplicates SCRUM-291 exists to prevent.

The server stays the only thing that decides when to draft. The client observes.
`RecommendationsScreen.test.tsx` asserts `generateRecommendation` is never called from the poll.

### 2. Polling, not SSE

The backend already ships two `SseEmitter` endpoints (`/conditions/stream`, `/actions/stream`),
so a third would have been consistent. It is still not worth it here:

**the thing generating the event is itself a 2-minute timer.** A stream would push an event that
a 60-second poll had already caught. That buys near-zero latency for a real new dependency —
React Native has no native `EventSource`, so mobile would need a client library, reconnect and
backoff handling, and auth-header plumbing that the existing `axios` layer already solves.

`REFRESH_INTERVALS.PLANS_MS` is 60 s: half the server cadence, which bounds the worst case at
roughly one interval rather than two.

**Revisit if `app.recommendation.auto-trigger.interval` ever drops materially below a minute.**
At that point polling starts losing to a stream and this decision should be re-argued.

---

## A bug found on the way in

`DecisionSection` gated the Approve/Edit/Reject buttons on `decided`, which is
`approval !== null || autoDispatched`. **A superseded plan has no approval** — nobody decided
anything, the server replaced it — so it fell straight through and offered all three buttons on
a plan that no longer applied. The comment on `decided` claimed SUPERSEDED hid the buttons.
Nothing did.

It mattered little while the screen loaded once on mount: a supervisor rarely saw the status
change under them. **Adding polling makes it the ordinary case**, which is what made fixing it
part of this change rather than a follow-up. Approving there would either 409 or, worse, approve
mitigations computed for a WBGT band that had already passed.

`SUPERSEDED` now shows a notice instead, checked *before* `canDecide`. Three tests cover it.

---

## Guards on the polling

Polling a decision surface is not free. Two suppressions, both deliberate:

| Condition | Why |
|---|---|
| `decidingId !== null` | `items` is the `FlatList`'s data, most-recently-drafted first. A refresh landing mid-decision reorders the list and can move a different plan under a press aimed at Approve. |
| an edit or reject sheet is open | A supervisor part-way through writing a rejection reason must not have the plan change underneath them. They get told when they close the sheet — a moment they chose. |

**Pull-to-refresh is never suppressed.** That is the supervisor choosing to refresh, which is a
different thing from a timer doing it to them.

---

## Enablement

`app.recommendation.auto-trigger.enabled` defaults to `false`, so nothing auto-drafts anywhere.
Enabled in `application-local.yml` **only**, so the feature is demonstrable and verifiable.

Staging and production enablement is deliberately out of scope: the scheduler makes real Bedrock
calls on every transition, so turning it on for an environment with live sites is a cost and
blast-radius decision belonging to whoever owns that environment. It should not arrive as a side
effect of a mobile ticket.

`interval` (2 m) and `lead-window` (30 m) are left at their defaults. The lead window is matched
to `LightningRiskProperties`' own strike-validity window — a strike detected more than 30 minutes
before a shift starts has aged out of relevance by the time anyone walks on site.

---

## Not done

**SCRUM-TBD-79 — verifying SCRUM-291's guards end to end.** The dedup, shift-state, lead-window,
`now < endsAt` and STALE-freshness guards are unit-tested server-side but have never been
exercised through the UI. They need a running local stack with weather and lightning ingestion
producing real transitions. Worth doing before this ships anywhere real, particularly the
`now < endsAt` clause: an ended-but-never-closed shift staying ACTIVE forever is the failure
mode that check exists to prevent, and SCRUM-442 (manual close) is not built.
