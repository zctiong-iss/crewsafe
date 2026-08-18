# SCRUM-TBD-90 — Oversight for safety managers

**Status:** Implemented
**Related:** SCRUM-291 (auto-trigger), SCRUM-440 (auto-dispatch), SCRUM-TBD-110 (latest plan per shift)

---

## Why plans are not grouped by supervisor

This is the decision most likely to look like an omission, and the obvious "fix" is to attempt
it again. It was not a preference — **the data does not support it.**

The ask was a three-level tree: site → supervisors → the plans belonging to each. Checked
against the model:

| | What it carries |
|---|---|
| `Shift` | `id`, `siteId`, `startsAt`, `endsAt`, `status`, `createdAt` — **no `createdBy`** |
| `Recommendation` | `shiftId`, and nothing identifying a person |
| `Approval` | `approverId` — **only exists after a decision** |

So a plan **awaiting** a decision — the thing a safety manager most needs to see — has nobody to
file it under. And since SCRUM-291 the majority of plans are drafted by the scheduler with **no
human author at all**, so most would land in a "system" bucket. A grouping whose largest group
is "nobody" is not a grouping.

**What ships instead:** site → plans, with the supervisor as a badge. The badge names the site's
supervisors — *accountability*, not authorship — because that is a fact the data actually
supports. It is deliberately shown on every plan whatever the status, since who answers for a
site does not begin at the moment someone decides something.

### Revisit condition

If **SCRUM-TBD-102** lands (a `createdBy` on `Shift` or `Recommendation`), regrouping becomes a
rendering change rather than a redesign. Note the hard part is not the column: the auto-trigger
drafts with no human involved, so the model needs an honest representation of that — likely a
first-class "drafted by the system" value rather than a null.

---

## Why the shift write endpoints changed (SCRUM-TBD-92)

The request was to remove the Plan a shift button "to prevent the safety manager from accessing
edit access to the shift". **Removing the button does not do that.**

Every mutating endpoint on `ShiftController` carried
`hasAnyRole('SUPERVISOR', 'SAFETY_MANAGER', 'ADMIN')` — create, correct, delete, cancel, staff,
change an assignment, remove an assignment. A manager holding a token could do all seven with no
client at all. The role was in that group because it inherited `SiteController`'s dashboard role
set, not because anyone decided a manager should plan shifts.

**The reads were deliberately left alone.** They carry `@siteAccess.canAccess` with no role
clause, and Oversight depends on it: a recommendation names only its `shiftId`, so the window a
plan applies to is reachable only by reading the shift. A role clause on the GETs would break
oversight while looking like a tightening. `ShiftWriteAuthorizationTest` asserts both directions
for that reason.

---

## Why ADMIN stayed on the supervisor tabs

The easiest thing to get wrong here. `SAFETY_MANAGER` moved to a read-only surface because the
server refuses it shift writes. **ADMIN still holds those permissions**, so moving it to Oversight
would remove access the API continues to grant — the inverse of the safety manager's case.
Pinned by a test, along with the unknown-role fallback to worker tabs.

---

## Built for twenty sites

Three decisions follow from a manager holding twenty or more memberships:

- **`FlatList`, not `ScrollView` + `.map`.** Twenty sites each holding a plan list is the
  difference between a screen that opens and one that stutters.
- **Plans load on expand.** One site costs a `fetchShifts` plus a call per shift; eager loading
  twenty is ~120 requests to render a list of names. Counts come from one summary call instead.
- **Sites sort by what needs attention.** Alphabetical would mean reading all twenty to find the
  one that matters.

Expansion state lives in a `Set` on the screen rather than inside each `Disclosure`: `FlatList`
unmounts rows on scroll, so self-held state would forget what was open. Same precedent as
`ShiftListScreen`'s crew toggle.

---

## The deliberate count/list divergence

The site's "N awaiting" totals **every** pending plan across all shifts, so after SCRUM-TBD-110's
collapse it can exceed the rows visible at rest. That is intended: the count is the triage signal
deciding which site to open, and reconciling it with the visible list would understate what needs
attention. Pinned by a test, because the mismatch reads as a bug to anyone who has not read this.

---

## Not done

- **SCRUM-TBD-102** — supervisor attribution (see revisit condition above).
- **Plans tab kept alongside Oversight.** The two answer different questions — "which of my
  twenty sites needs attention" versus "everything for the one selected site" — and a manager is
  read-only on both, so neither offers an action the server would refuse. Worth revisiting if it
  proves redundant in use.
