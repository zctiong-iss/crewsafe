# SCRUM-125 — Worker logs rest / hydration or raises a concern

US-11, feature F-12. Mobile (React Native) + Backend (Spring Boot). Branched from `origin/main`.

## Outcome

A worker can record a rest or a drink with one tap, or tell their supervisor they are unwell.
A supervisor sees how the crew is coping on the shift they are already looking at, and gets a
separate tab — with a count — for workers reporting that something is wrong.

## Starting state

Nothing in the system recorded either. Two things existed nearby and were deliberately not reused
as-is:

- **`readiness_submission` (V7)** is a *pre-shift* gate carrying `adequate_hydration` as a boolean
  and a `SymptomFlag` set. That answers "am I fit to start", asked once. SCRUM-125 is an ongoing log
  *during* the shift, so the table is not reusable — but the **symptom vocabulary is**, and is.
- **The rest timer (SCRUM-206)** already counted down an acknowledged `REST_15_MIN` and dismissed
  the card. That recorded *rest instructed and acknowledged*, never *rest taken*, because
  `POST /api/action-dispatch/{id}/complete` had existed since SCRUM-185 and **nothing had ever
  called it**.

## Approved design

- **Two tables, not one.** A rest or a drink is a fact with no state; a concern has a life. One
  table would give every drink of water a status column meaningless for all but a fraction of the
  rows.
- **A log is a timestamp and a kind. Nothing else.** No duration, no note. The control has to work
  in gloves, in the sun, mid-shift, and anything asking a follow-up question gets used once and
  then ignored. "Has anyone not rested in two hours?" is answered by the timestamp alone.
- **`SELF` vs `INSTRUCTED`.** A crew that rests only when told to is coping differently from one
  that rests on its own; the tag is the only thing on screen that distinguishes them.
- **Completing a rest dispatch writes a log.** Otherwise "has this crew rested?" has two answers
  in two places. Keyed off the action code, never the instruction text — that text is
  server-authored English and matching on it works here and nowhere else. `dispatch_id` is unique,
  so a retry cannot record a second rest, and a failure to derive the log is swallowed rather than
  unwinding a completion the worker already earned.
- **Concerns reuse `SymptomFlag`.** Already translated in all seven locales; a parallel list would
  mean the same dizziness reported in two places that no report could join on.
- **The note is optional and stays optional.** A worker must never be unable to report that they
  are unwell because they cannot write in a language their supervisor reads. When present it is
  shown as written and labelled as the worker's own words — the app cannot translate it, and
  pretending otherwise would put words in someone's mouth on a safety record.
- **`NONE` is not offered when raising a concern.** It exists for the readiness check, where "any
  symptoms?" needs a negative answer. Someone opening this sheet is already saying something is
  wrong.
- **`OPEN` until acknowledged, and no `RESOLVED`.** The app can know a supervisor read the report.
  It cannot know whether the worker is now all right.
- **A worker can only report about themselves.** No `workerId` in any request or path; every write
  also checks the caller is assigned to the shift. Without that a worker could log rest against a
  crew they have nothing to do with.
- **A second acknowledgement is 409, not an overwrite.** Who responded first is the fact worth
  keeping.
- **Oversight reads, supervisors act.** `SAFETY_MANAGER` sees concerns; only `SUPERVISOR`/`ADMIN`
  may acknowledge, because acknowledging claims someone acted.
- **Crew wellbeing above the assignment cards; concerns in their own tab.** Who is on a shift
  changes rarely; whether someone has drunk water in two hours changes constantly. A concern is
  time-sensitive in a way a hydration timestamp is not, so it gets a tab with a badge rather than
  a section you have to go looking for.
- **The crew list is driven by the shift roster, not the wellbeing response.** The endpoint only
  returns workers who have logged something, so a worker with nothing would vanish — and that is
  precisely the row worth acting on.
- **The badge loads when the tab bar mounts.** A count that appears only after you open the tab
  tells you nothing you did not already know by opening it.

## What was built

**Backend** — `V11__wellbeing_log_and_concern.sql`; `WellbeingLog` and `Concern` domain;
two repositories; `WellbeingService`; `WorkerWellbeingController` (log, raise) and
`SupervisorWellbeingController` (crew summary, raw logs, concerns, acknowledge);
`ActionDispatchService.recordRestIfThisWasOne`; three new `AuditEventType` constants.

**Mobile** — wellbeing domain types; `api/endpoints/wellbeing.ts` + mock; `wellbeingSlice`;
`WellbeingLogCard`, `RaiseConcernSheet`, `CrewWellbeingRow`; `ConcernsScreen` and its tab and
stack; the crew card on `ShiftDetailScreen`; `completeDispatch` + the `completeRest` thunk wired
to rest-timer expiry; 44 new locale keys plus the `symptoms.*` block across all seven languages.

## Verification

Backend 376 tests (up from 372). The two worth naming: a worker cannot log against a shift they
are not on, and a worker cannot acknowledge their own concern — which would defeat the entire
point of the `OPEN` state.

Mobile 176 tests (up from 170), typecheck clean, lint 0 errors, 370 locale keys in parity.

On the emulator against the live Cognito stack: worker1 logged a rest and a drink (both landed as
`SELF` with server timestamps) and raised a concern with two chips and a note. As supervisor1 the
Concerns badge already read **1** before the tab was opened; the shift showed Meng Hui's last rest
and drink and **Siti as "Nothing logged yet"**; the concern rendered with translated chips, the
note labelled as the worker's own words, and a red border. Acknowledging it flipped the card to
"Seen", cleared the badge, kept the card on the list, and wrote `CONCERN_ACKNOWLEDGED` to the
audit trail alongside `CONCERN_RAISED` and two `WELLBEING_LOGGED`.

## Known limits

- **Instructed-rest auto-log is not yet device-verified.** It needs an approved recommendation to
  produce a `REST_` dispatch, which needs SCRUM-118 or a seeded recommendation; the path is
  covered by unit and integration tests but not by a screenshot.
- The crew summary is per shift. A supervisor running several crews checks each shift in turn;
  a site-level roll-up is a later ticket if anyone asks for it.
- No duration on a rest. Deliberate — see the design note — and addable without invalidating
  anything already recorded.
- No notification when a concern is raised. The badge is only visible to a supervisor with the app
  open; push is out of scope here.

## Merge note

Branched from `origin/main`, so this is independent of SCRUM-300/301/302 (the SCRUM-119 branch),
which is still unmerged. Both add a supervisor tab and locale keys, so whichever merges second
will hit additive conflicts in `SupervisorTabs.tsx`, `stacks.tsx`, `navigation/types.ts`,
`store.ts` and the seven locale files. No migration conflict: SCRUM-119 adds none, and this takes
V11.
