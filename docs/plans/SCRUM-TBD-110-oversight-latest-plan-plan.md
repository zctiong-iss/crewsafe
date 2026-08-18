# SCRUM-TBD-110 — Oversight shows the current plan per shift

**Status:** Implemented
**Branch:** `feat/scrum-tbd-110-oversight-latest-plan`
**Related:** SCRUM-291 (auto-trigger), SCRUM-440 (auto-dispatch), SCRUM-TBD-90 (Oversight)

**Frontend only.** No backend file is touched, and none needed to be — see the last section.

---

## What was wrong

A site accumulates one plan per WBGT band or lightning transition. On a volatile day that is
five or more within an hour, almost all of them superseded the moment conditions moved again.
The Oversight card listed every one, so a manager scrolled past four dead rows to reach the live
one.

Two bugs turned up while scoping, both visible in the report:

**The list was not sorted at all.** `OversightScreen` rendered `plans.items.map(...)` in raw
array order, and `oversightSlice` built that array by flat-mapping one `fetchRecommendations`
call per shift with no sort. Natural order was therefore "whichever shift resolved first, then
whatever the server returned inside it" — which is how a plan drafted at **15:17** came to
render above one drafted at **15:09**. Any notion of "latest" was undefined until this was
fixed, so it was done first.

**`items` spans every shift on the site.** A naive "latest per site" would have hidden a plan
awaiting a decision on one crew because an unrelated crew got a newer draft.

---

## The rules now

Plans group **per shift**, and each group shows its **newest plan by `createdAt`**, whatever the
status. The rest collapse behind an "N earlier plans" control — kept, never dropped, because a
manager asking why a plan was superseded needs the plan it replaced, and that question is what
oversight is for.

**Status never decides what is current.** If the newest plan is `SUPERSEDED`, it shows as
`SUPERSEDED`. That case is rarer than it looks — supersession happens immediately before a
replacement is drafted, in the same transaction — so a superseded plan is only newest when the
draft that replaced it failed. Filtering by status would hide exactly the signal that something
went wrong.

### The one exception: an in-force stop-work is never collapsed

An `AUTO_DISPATCHED` plan was sent to a crew without approval (SCRUM-440). It is a live
instruction, not a record of one, so it stays visible alongside the newest plan even when
something newer exists on the same shift.

### Shift windows

Showing one plan per shift produces N visually identical rows unless each names its crew — two
rows reading "Awaiting decision · Aisyah (Supervisor)" look like one row rendered twice. The
windows were already being fetched and thrown away: `loadSitePlans` called `fetchShifts` and
kept only the ids. Keeping them costs no extra request.

---

## Two deliberate inconsistencies

**The site's "N awaiting" count still totals every pending plan**, so it can exceed the number of
rows visible at rest. That is intentional: the count is the triage signal deciding which of
twenty sites a manager opens, and making it agree with the visible list would understate what
needs attention. Pinned by a test, because the obvious "fix" is to reconcile them.

**A stop-work can appear below a newer plan.** Strict reverse-chronological ordering would put it
elsewhere or hide it. Being visible beats being sorted.

---

## The backend change that was asked for and is not needed

The request included adding a validation so a new auto-dispatch cannot supersede an in-force
stop-work. **That guard already exists**, implicitly and more robustly than an explicit check
would be:

```java
private void supersedeOpenRecommendation(UUID shiftId) {
    recommendations.findFirstByShiftIdAndStatusOrderByCreatedAtDesc(
            shiftId, RecommendationStatus.PENDING_APPROVAL)   // ← only pending
```

`supersedeOpenRecommendation` selects **only** `PENDING_APPROVAL`. No other status can be
superseded by any path, so an `AUTO_DISPATCHED` plan is untouchable server-side. The reported
screenshot confirms it empirically: two stop-works at 15:17 and 15:26, both still dispatched,
neither having replaced the other.

**Do not add a second guard for this.** Two checks enforcing one invariant drift, and the pair
eventually disagree. If the invariant is ever worth making explicit, the right form is a backend
test pinning it — not a conditional in the write path.

### SCRUM-TBD-120 — the decision, recorded

Whether to pin the invariant with a dedicated backend test was left open. **Recommendation: yes,
but not on this branch.**

The reasoning splits. A *conditional* in `supersedeOpenRecommendation` would be redundant today
and harmful tomorrow — the query already cannot select a non-pending row, so a second check adds
a branch that is unreachable until someone widens the query, at which point the two disagree and
the reader has to work out which is authoritative.

A *test* has the opposite property: it fails precisely when someone widens the query, which is
the moment the invariant stops holding and the only moment anyone needs telling. It costs one
assertion and no production branch.

It is not on this branch because SCRUM-TBD-110 is frontend-only by requirement, and adding a
backend test file — even one that touches no production code — would put this change into
Backend CI and muddy a scope that was explicitly bounded. Raise it as a backend ticket:

> Given a shift with an `AUTO_DISPATCHED` recommendation, when `generateAuto` runs, then the
> dispatched plan's status is unchanged and only a `PENDING_APPROVAL` plan is superseded.

Until then the invariant is documented here and asserted indirectly by
`planGrouping.test.ts`, which encodes the client's dependence on it.

---

## Testing note worth keeping

The ordering tests use a **two-shift** fixture on purpose. With one shift, `items` is already in
the server's order and looks correct whether or not a sort exists — a single-shift test would
have passed against the broken code, which is precisely why the bug survived to production.
