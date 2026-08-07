# SCRUM-266 — Editing a shift and its assignments after creation

A supervisor can plan a shift and can delete it. They cannot change anything about it. So the
only way to fix one worker's acclimatisation day is to delete the whole shift — destroying every
other assignment on it — and rebuild it from scratch.

This makes the shift and its assignments editable.

---

## What already exists, verified against `main`

**The backend is already capable.** This is a mobile gap, not a domain one.

| Capability | Endpoint | Status |
| --- | --- | --- |
| Edit the shift window | `PATCH /api/v1/sites/{siteId}/shifts/{shiftId}` | exists |
| Edit a worker's details | `PATCH …/shifts/{shiftId}/assignments/{assignmentId}` | exists — `taskName`, `intensity`, `acclimatisationDay` |
| Add a worker | `POST …/shifts/{shiftId}/assignments` | exists |
| Remove a worker | `DELETE …/shifts/{shiftId}/assignments/{assignmentId}` | exists |

`ShiftService.updateAssignment` calls `assignment.correct(...)` and records a
`SHIFT_ASSIGNMENT_UPDATED` audit event. The domain was built for correction; only the client was
not.

**The mobile client has no PATCH at all.** `api/endpoints/shifts.ts` offers `fetchShifts`,
`fetchShift`, `fetchSiteWorkers`, `deleteShift` and `createShift`. `ShiftDetailScreen` renders
task, intensity and acclimatisation as read-only text with a single action: Delete.

---

## Part 1 — Supervisor edits (mobile only)

### Scope

Every field, as requested: the shift window, and each assignment's task, intensity and
acclimatisation day, plus adding and removing workers.

### Where

**In place on `ShiftDetailScreen`, not a new screen.** The fields are already laid out there;
making each row editable is less code than a parallel screen that duplicates the layout and then
drifts from it. The inputs come from `CreateShiftScreen` rather than being rewritten, so the two
cannot disagree about what a valid acclimatisation day is.

### The state rule

| Shift status | Editing |
| --- | --- |
| `SCHEDULED` | freely editable |
| `ACTIVE` | allowed, behind an explicit confirmation |
| Ended | **blocked** |

The confirmation on `ACTIVE` is not ceremony. A worker mid-shift whose intensity goes MODERATE →
HEAVY has their heat obligations change underneath them, and the dispatch inbox may already hold
actions computed from the old value. The supervisor should be told that before they commit, not
after.

Ended shifts are blocked because editing one rewrites history that the audit trail and any
downstream report have already recorded.

**Enforce this server-side too, not only in the UI.** A rule that lives only in the client is a
rule that any other client ignores. The endpoints already exist and currently accept an edit at
any status, so this is a real change to `ShiftService`, and it is the one piece of Part 1 that is
not mobile-only.

### Permissions

Requested: **SUPERVISOR only.**

**I would push back on this.** Creating a shift is currently open to `SUPERVISOR`,
`SAFETY_MANAGER` and `ADMIN`. Making editing narrower means a safety manager can create a shift
they are then unable to correct — and their only remaining remedy is the delete button, which is
the destructive path this ticket exists to remove. `RootNavigator` also states that ADMIN "holds
every permission a supervisor does", so a narrower edit rule contradicts a documented assumption.

Recommendation: keep edit permissions **the same as create**. If the intent is that only
supervisors touch rosters, narrow *both* — but as one deliberate decision, not a split.

Recorded as a question rather than silently implemented either way.

---

## Part 2 — Workers seeing the change: blocked

The request is that a worker sees an edit immediately. **They cannot see it at all today.**

`GET /api/v1/shifts/me` does not exist on any deployment, and `fetchMyShift` returns
`mockMyShift()` unconditionally. The *My shift* screen shows a hardcoded fixture — "Kerb laying,
east verge / Heavy / Acclimatisation day 3 of 7" — no matter what any supervisor does. A
supervisor's edit will change the database correctly and the worker's screen will not move,
because it is not reading from the database.

The conditions SSE stream cannot stand in: `ActiveShiftPayload` carries only `shiftId`,
`startsAt` and `endsAt` — no task, intensity or acclimatisation — and it is restricted to
supervisors and above anyway.

So Part 2 needs a backend story first: **`GET /api/v1/shifts/me`**, returning the caller's own
current or upcoming assignment. The response shape is already committed to by
`mobile/src/api/mock/myShift.ts`; matching it makes the mobile change deleting a branch rather
than rewriting a screen. This is the same shape of blocker SCRUM-261 hit with lightning, and it
lands the same way.

### What "immediately" should mean

Once `/shifts/me` exists, the shift screen already polls every 60 seconds (`SHIFT_MS`), so an
edit reaches the worker within a minute with no new machinery.

**Recommendation: accept one poll interval rather than build push.** A shift edit is not a
stop-work; sixty seconds is not the difference between safe and unsafe, and a long-lived
connection costs battery on a phone that has to last an outdoor shift. If genuinely instant
delivery is wanted later, it belongs with the existing SSE work rather than bolted on here.

A visible cue is worth more than the last few seconds of latency: if the task or intensity
changes while a worker is on the screen, say so, rather than swapping the text silently under
them. That is cheap and it is what makes the change trustworthy.

---

## Risks

**Editing what the policy engine already acted on.** Intensity feeds the heat obligations. An
edit mid-shift can invalidate a dispatched action that a worker has already acknowledged. This
ticket does not resolve that — it surfaces it at the point of edit and records it here.

**Two screens drifting.** `CreateShiftScreen` and the edit path must share their inputs and
validation, or they will eventually disagree.

**Audit completeness.** `SHIFT_ASSIGNMENT_UPDATED` is recorded already; the shift-window edit
path should be checked to confirm it records equivalently.

## Acceptance

- A supervisor can change task, intensity and acclimatisation day on an existing assignment, and
  the change persists across a reload.
- A supervisor can add and remove workers on an existing shift, and edit the shift window.
- `SCHEDULED` edits freely; `ACTIVE` edits require confirmation naming the consequence; ended
  shifts cannot be edited — **enforced server-side and asserted by a test**, not only greyed out.
- Deleting the shift is no longer the only way to correct one field.
- Verified on the emulator as `supervisor1`, and the change confirmed in the database.
- Part 2 acceptance depends on `/shifts/me` and is written against it, not against the fixture.

## Out of scope

**Push delivery to the worker.** One poll interval is the accepted latency; see above.

**Recomputing or withdrawing already-dispatched actions** after an intensity change. Real, and
larger than this ticket.
