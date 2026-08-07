# ADR 0013 — Store timestamps in UTC; render in a pinned Asia/Singapore display zone

**Status:** Accepted
**Date:** 2026-08-04

## Context

The first user-facing timestamp rendering arrives with the shifts list (SCRUM-161), in
[`formatShiftRange`](../../web/src/features/shifts/formatShiftRange.ts) — a shift is two instants
and a supervisor reads a range. The backend sends each instant as a UTC ISO string (the `Z`
suffix, e.g. `2026-08-10T00:00:00Z`), so the frontend must decide which **wall clock** to show
it on.

A timezone plays two independent roles, and conflating them is the trap:

- **Storage / transport zone** — how the instant is persisted and sent over the wire. This is
  UTC and stays UTC; it is the one unambiguous reference every service agrees on.
- **Display zone** — the wall clock the instant is projected onto for a human to read. This is a
  presentation choice, separate from storage.

`Intl.DateTimeFormat` with **no** `timeZone` option formats in the *host's* zone — the viewer's
device, or the CI runner. That looks correct on a Singapore laptop only by coincidence, and it
leaks in two concrete ways.

| | Host-default zone | UTC on screen | **Pinned `Asia/Singapore`** |
|---|---|---|---|
| Correct for a field supervisor on site | only if their device is set to SGT | no — nobody on the ground reads UTC | **yes, always** |
| Same instant renders identically on any device / CI | no — follows the host | yes | **yes** |
| Same-day vs cross-day logic is stable | no — the midnight boundary moves with the host zone | yes | **yes** |
| A shift at 08:00 SGT shows as | 08:00 (SGT host) / 00:00 (UTC host) | 00:00 | **08:00** |

The concrete bite surfaced during SCRUM-161: this machine's Node default zone is
`Asia/Singapore` (no `TZ` pin in the test harness), and the original test fixture straddled
midnight in *UTC* but not in SGT. Because the same-day check used `Date.toDateString()` — which
also reads the host zone — the branch itself was host-dependent and the cross-day test went
**red** locally while it would have passed on a UTC CI box. "Works on my machine" was hiding a
real display bug on any non-SGT runtime.

## Decision

**Store and transport in UTC; pin the display zone to `Asia/Singapore`.**

- Every date/time formatter passes `timeZone: "Asia/Singapore"` (a `SITE_ZONE` constant in
  `formatShiftRange.ts`, reused by any future formatter). UTC remains the wire format; `new Date()`
  parsing is unchanged.
- The same-day / cross-day decision compares a **day key produced in the same pinned zone**
  (an `en-CA` `YYYY-MM-DD` formatter), **not** `Date.toDateString()` — so the branch decision and
  the displayed date can never disagree across hosts.
- Locale stays pinned to `en-GB` for stable wording (`10 Aug`, 24-hour clock) independent of the
  viewer's locale.

## Consequences

- **Rendering is deterministic on any host or CI runner** — a shift reads the same SGT wall clock
  on a supervisor's phone, a laptop, and a UTC build box. Correctness is intrinsic to the code,
  not incidental to where it runs.
- **Input is the mirror of display, and is currently host-zoned.** The create form's
  [`<input type="datetime-local">`](../../web/src/features/shifts/CreateShiftForm.tsx) yields a
  zoneless wall-clock string that `new Date(...)` interprets in the *host's* zone before
  `.toISOString()` converts it to UTC for the API. On a Singapore device this round-trips
  correctly against the SGT display (type `22:00` → store `14:00Z` → show `22:00`); on a non-SGT
  device the typed time would be interpreted in the wrong zone. This is the same "correct by
  coincidence" property display had, with the same trigger to revisit — cross-border operation.
  No fix now: supervisors enter shifts on-site in Singapore.
- **Time-formatting tests must use fixtures that straddle midnight in SGT**, not UTC. The
  cross-day case in `formatShiftRange.test.ts` uses `13:00Z → 18:00Z` (21:00 → 02:00 SGT).
- **The pin is effectively permanent, not a stopgap.** CrewSafe operates in Singapore only — one
  civil zone, no DST. **SCRUM-134 (the safety-manager multi-site dashboard) does not change this:
  every site it aggregates is in Singapore, so the whole board renders in the same pinned SGT.**
  The multi-site work reinforces the pin — a manager viewing many sites wants one consistent
  clock regardless of their own device — rather than requiring per-site timezones.
- **Revisit only on cross-border expansion.** If CrewSafe ever runs sites outside Singapore, the
  `SITE_ZONE` constant becomes a per-site value threaded from a `Site.timezone` field into the
  same `timeZone` option. No such ticket exists today; do not build it pre-emptively.

## Alternatives

- **Host-default zone (`Intl` with no `timeZone`).** Rejected — correct only by coincidence on a
  SGT device, host-dependent, and it makes same-day logic and tests non-deterministic (renders in
  UTC on a UTC CI runner).
- **Display UTC to the user.** Rejected — a field supervisor is physically on a Singapore site
  and thinks in local time; showing `00:00` for an 08:00 SGT shift is exactly the misread this
  formatter exists to prevent. (Deliberate UTC display belongs to distributed cross-zone
  coordination screens — "Zulu time" — which is not CrewSafe's user.)
- **Thread per-site `Site.timezone` now.** Rejected as premature — all sites are SGT, so it would
  be dead complexity carrying a field that only ever holds one value. Deferred to a genuine
  cross-border need, not to SCRUM-134.

## Amendment — 2026-08-07 (SCRUM-169)

The decision above stands. Three facts it records have changed, and one new decision follows from
them. Original text left intact; this section is the current state.

**1. The test harness now pins `TZ`.** The Context notes "no `TZ` pin in the test harness" — no
longer true. [`vite.config.ts`](../../web/vite.config.ts) sets `test.env.TZ = "Asia/Singapore"`, so
a developer's machine and CI can no longer disagree. This makes the *suite* deterministic; it does
not make the *app* host-independent. See point 3.

**2. The input control changed; the property did not.** Consequence 2 above cites
`<input type="datetime-local">`. That was replaced by `react-datepicker` (SCRUM-169 Task 2). The
picker still yields a `Date` built in the host's zone, which `.toISOString()` then converts using
the host's offset — so the "correct by coincidence" property is unchanged, only its mechanism.

**3. The write path is still host-zoned, and now has a measured cost.** Typing `10 Aug 2026, 08:00`
into the create form stores `00:00:00Z` on an SGT host and `08:00:00Z` on a UTC host — an
eight-hour drift, verified by `CreateShiftForm.test.tsx` under `TZ=UTC`. Two consequences reach
past display:

- `ShiftService.guardAgainstDoubleBooking` compares instants, so a drifted shift changes which
  bookings are detected as overlapping.
- WBGT exposure is assessed against the shift's instants, so a drifted shift is scored against the
  wrong part of the day. This is the safety-relevant one.

No repair is possible for rows already written: nothing records the submitting browser's zone, so
pre-cutover shifts cannot be identified, let alone corrected. Closing this properly means a
zone-aware parse at the form boundary using the selected site's `timezone` (e.g. `date-fns-tz`
`fromZonedTime`), not a hardcoded `+8` — which works only while every site is DST-free.

**4. New decision — audit rows record the wall clock and its IANA zone.** `AuditEvent.detail`
(500 chars, currently using ~40) will carry the shift's local wall-clock range and the zone it was
read in, sourced from `Site.timezone` rather than a constant:

```text
Created shift for site <id> (10 Aug 2026 08:00–16:00 Asia/Singapore)
```

Rationale: `occurredAt` is a server-side `Instant` and is unaffected by any of the above, but an
audit *report* is only useful joined back to `shift.startsAt` — and that column now holds values
derived under two different rules with nothing in the schema to distinguish them. Embedding the
wall clock and zone makes each row self-describing, independent of both the join and the
derivation rule in force when it was written. It also means the audit trail stays correct on its
own terms if CrewSafe ever runs a site outside Singapore, which is the trigger the original
decision names for revisiting `SITE_ZONE`.

Status: **implemented** (SCRUM-169). `ShiftService.localRange` resolves the zone from
`SiteRepository`, applies it to `SHIFT_CREATED` and `SHIFT_UPDATED`, names both dates when a shift
runs past local midnight, and falls back to UTC — labelled as UTC — for an unknown site rather than
quietly asserting SGT.

## Related

- [`formatShiftRange.ts`](../../web/src/features/shifts/formatShiftRange.ts) — where `SITE_ZONE`
  is pinned and the same-zone day-key comparison lives.
- [ADR 0010](0010-flat-routing-site-scoped-screens.md) — establishes that SCRUM-134 is the
  multi-*site* work (all Singapore), the context this decision leans on.
- [SCRUM-161 plan](../plans/SCRUM-161-create-shift-form-plan.md) — the ticket this decision was
  made under.
