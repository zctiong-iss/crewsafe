# SCRUM-139 (US-44) — Shift close-out summary — build-ready spec

**Story (SCRUM-139, To Do):** *As a Site Supervisor, I want an end-of-shift summary of
conditions, actions issued, acknowledgements and exceptions, so that the shift is formally
closed with a single record I can defend.*

**Acceptance (from Jira):** Summary totals reconcile with the audit trail; closed shift is
immutable and exportable.

**Impl technologies (from Jira):** Web (React) · Backend (Spring Boot aggregation) · PostgreSQL
append-only audit.

> Spec written 2026-08-20 on `feature/SCRUM-139-close-out-summary`. Author: Tang Chee Seng
> (with Claude). Program sequence: item 3 in `~/.claude/plans/let-s-refer-to-the-parsed-peach.md`.

---

## 1. What already exists — verified against `main` before speccing

| Acceptance clause | Status | Evidence |
|---|---|---|
| Closed shift is **immutable** | ✅ **Already done** — no work | `ShiftService.assertEditable` blocks all edits on a `CLOSED` shift and on any shift whose `endsAt` has passed; every mutating path routes through it. Close is one-way (no un-close). SCRUM-266 / SCRUM-442. |
| Summary totals **reconcile with the audit trail** | 🔨 Gap | No aggregation exists. |
| Closed shift is **exportable** | 🔨 Gap | Only a *site-wide* audit CSV export exists (`GET /sites/{siteId}/audit/export.csv`), not a per-shift record. |
| The **web summary view** | 🔨 Gap | No shift-summary surface. |

So US-44's real work is three things: a **backend aggregation** reconciled to the audit trail, a
**per-shift CSV export**, and a **web view**. Immutability contributes one *lock-in test*, not new code.

---

## 2. The reconciliation design (the crux — why totals cannot drift)

`AuditExportRepository.SITE_SCOPED_FROM` already resolves an **effective shift** for every audit
event, whatever its target type, via one `COALESCE` join:

```
LEFT JOIN shift sh ON sh.id = COALESCE(
    CASE WHEN ae.target_type = 'SHIFT' THEN ae.target_id END,
    rec.shift_id, rs.shift_id, wl.shift_id, c.shift_id)
```

US-44 **reuses that exact join**, pivoted from "resolve effective *site*, filter by `:siteId`" to
"resolve effective *shift*, filter by `:shiftId`, group by `event_type`". Because the summary counts
are computed *from the audit rows themselves*, "totals reconcile with the audit trail" is a
**structural guarantee, not a comparison** — the number on screen is a `COUNT(*)` of the very rows
the audit export would print.

- **Decision — put the shift-scoped query in the audit module (`AuditExportRepository`), not a new
  copy in the shift module.** *Effective-shift resolution over the audit trail belongs where the
  effective-*site* resolution already lives; a second copy of that `COALESCE` join is the thing that
  drifts.* The site query and the new shift query share the join fragment.

---

## 3. API contract

All under the existing site-scoped shift path; `@siteAccess.canAccess(#siteId)` on every method.

### 3.1 `GET /api/v1/sites/{siteId}/shifts/{shiftId}/summary` → `200 ShiftCloseSummaryResponse`

```jsonc
{
  "shiftId": "…", "siteId": "…", "siteName": "Tuas Marine Yard",
  "startsAt": "…Z", "endsAt": "…Z", "status": "CLOSED",
  "localRange": "20 Aug 2026 08:00–16:00 Asia/Singapore",  // reuses ShiftService range formatter
  "workerCount": 4,                    // assignment rows on the shift
  "closedAt": "…Z", "closedByName": "Priya Nair",   // from the SHIFT_CLOSED audit event; null if not closed

  "conditions": {                      // "Readiness + peak band" (locked decision)
    "readinessSubmissions": 6,         // audit-derived: READINESS_SUBMITTED effective-shift rows
    "peakWbgt": 32.4,                  // MAX(wbgt) over [startsAt, endsAt); null if no observations
    "peakBand": "32_TO_BELOW_33"       // WbgtBand.classify(peakWbgt) — pure fn, statutory 31/32/33; null if no reading
  },

  "actions": {                         // all audit-derived from the effective-shift rows
    "issued": 5,                       // ACTION_DISPATCHED + ACTION_AUTO_DISPATCHED
    "acknowledged": 4,                 // ACTION_ACKNOWLEDGED
    "completed": 5,                    // ACTION_COMPLETED + ACTION_AUTO_COMPLETED
    "exceptions": 2                    // ACTION_LATE + CONCERN_RAISED (see §4)
  },

  "totalAuditEvents": 21,              // COUNT(*) of every effective-shift row — the reconciliation anchor
  "eventCountsByType": { "SHIFT_CREATED": 1, "ACTION_DISPATCHED": 3, … }  // full breakdown; the view sums named buckets from this
}
```

- The named buckets (`issued`, `acknowledged`, …) are **derived server-side from
  `eventCountsByType`**, so the wire carries the raw truth and the labels are one place. The invariant
  the tests assert: **every event type is either in a named bucket or in an "other" remainder, and
  the buckets + remainder sum to `totalAuditEvents`.** Nothing is silently dropped.

### 3.2 `GET /api/v1/sites/{siteId}/shifts/{shiftId}/summary/export.csv` → `200 text/csv`

- **New shift-scoped CSV** (locked decision). Reuses `AuditQueryService`'s RFC-4180 writer, the
  CSV-injection guard, and the SHA-256 trailer + `verify_with` line — the same evidentiary shape as
  the site export, scoped to this shift's effective rows via `findShiftSlice(shiftId)`.
- Trailer carries `shift_id`, `site_name`, the shift's local range, `row_count`, `sha256`.
- **Self-audits** with `AUDIT_EXPORTED` (reuse; detail names the shift), same as the site export —
  pulling a shift's evidence is itself evidence worth keeping.

### 3.3 Authorization (Opus-owned security decision — flag for review)

| Endpoint | Gate | Rationale |
|---|---|---|
| `…/summary` | `hasAnyRole('SUPERVISOR','SAFETY_MANAGER','ADMIN') and @siteAccess.canAccess(#siteId)` | The story's actor is the **Site Supervisor** ("a record *I* can defend"). The summary is **aggregate counts of the supervisor's own shift**, not the raw cross-actor audit timeline — operational self-review, not oversight-of-oversight. Matches the existing `POST …/close` gate exactly. |
| `…/summary/export.csv` | same three roles + `@siteAccess` | The exportable "single record" the story asks the supervisor to be able to produce. |
| raw per-row audit timeline (`/sites/{siteId}/audit`) | **unchanged** — `SAFETY_MANAGER`/`ADMIN` only | US-44 does **not** widen this. A supervisor gets totals for their shift, not the manager's row-level trail. |

> **Review anchor:** the one judgment call is letting a `SUPERVISOR` export a shift-scoped CSV when
> the site-wide audit export is manager-only. Defensible because the artifact is this shift's own
> record (the thing the story says the supervisor must be able to defend), not the site trail. Called
> out here so a reviewer decides deliberately rather than by omission.

---

## 4. Scope decisions — logged (`X over Y because…`)

1. **Immutability = a lock-in test, not new code.** *Already enforced by `assertEditable`; the risk
   is a future edit-path bypassing it, so we add a test asserting a `CLOSED` shift rejects
   edit/assignment mutations — over writing new guard code that would duplicate the existing rule.*
2. **Conditions = readiness count + peak WBGT + peak band** (locked). *Peak band is cheap — one
   indexed `MAX(wbgt)` + the pure `WbgtBand.classify` — so it ships; over the raw WBGT number alone,
   because a band is what a supervisor reads.*
3. **Time-in-band / heat-band timeline is OUT.** *That needs per-observation bucketing across the
   window (a timeseries roll-up), which is the "full heat-band timeline" cut we explicitly deferred —
   over including it, because it multiplies the query cost and the story asks for a *summary*, not a
   chart.* → Phase-2 fast-follow if wanted.
4. **Exceptions = `ACTION_LATE` + `CONCERN_RAISED`.** *A late (unacknowledged past window) action and
   a worker raising a concern are the two "this shift didn't go clean" facts a defensible record must
   surface — over folding auto-completions in, because an auto-complete is the system closing the
   loop, not an exception.*
5. **The summary view links out to the manager audit page for row detail; it does not embed the
   timeline.** *Keeps the supervisor surface aggregate and the manager-only raw trail where it is —
   over duplicating a row table the supervisor isn't cleared to read.*

---

## 5. Acceptance criteria — as tests

**Backend (`ShiftCloseSummaryServiceTest` + repository slice test + `ShiftSummaryControllerTest`):**
- AC1 `totalAuditEvents` equals the count of rows the site export would return **filtered to this
  shift** (reconciliation anchor) — asserted by seeding N mixed events across target types and
  checking the count matches an independent effective-shift count.
- AC2 named buckets map the right event types: dispatch+auto-dispatch→`issued`, ack→`acknowledged`,
  complete+auto-complete→`completed`, late+concern→`exceptions`.
- AC3 buckets + "other" remainder **sum to `totalAuditEvents`** (nothing dropped).
- AC4 `peakWbgt`/`peakBand` = `MAX(wbgt)` over `[startsAt,endsAt)` classified; **null band** when the
  window has no observation (not `BELOW_31`).
- AC5 `closedByName`/`closedAt` resolved from the `SHIFT_CLOSED` event; **null** for a not-yet-closed
  shift, and the endpoint still returns a summary (an ACTIVE shift can be previewed).
- AC6 **immutability lock-in:** a `CLOSED` shift rejects `PATCH`/assignment mutations with 400
  (guards the acceptance clause that's already true).
- AC7 export CSV: header on line 1, one row per effective-shift event, `#`-prefixed trailer with
  `sha256`, and `grep -v '^#' | shasum -a 256` verifies — mirrors the site-export test.
- AC8 authz: `WORKER` → 403 on both endpoints; `SUPERVISOR` on the site → 200; a supervisor **not** a
  member of the site → 403 (`@siteAccess`).
- AC9 self-audit: hitting `…/export.csv` writes one `AUDIT_EXPORTED` row naming the shift.

**Web (`ShiftCloseOutSummary.test.tsx`, `api/shiftSummary.test.ts`):**
- AC10 renders each bucket with its label + count; shows the local range and closed-by line.
- AC11 peak band renders as a CVD-safe band pill (reuse existing band tokens/component); "No
  readings" when `peakBand` is null.
- AC12 the Download CSV control calls `apiDownload` with the shift-scoped URL.
- AC13 vitest-axe: **0 violations** on the summary view.

---

## 6. Build sequence + ownership (token-economy model)

| # | Task | Owner | Files |
|---|------|-------|-------|
| 1 | This spec | Opus | `docs/plans/SCRUM-139-close-out-summary-spec.md` ✅ |
| 2 | Repo query: shared effective-shift join fragment + `countByEventTypeForShift` + `findShiftSlice` | Opus | `AuditExportRepository.java` + `AuditEventTypeCount.java` ✅ |
| 3 | Peak-WBGT query | Opus | `WeatherObservationRepository.findMaxWbgt` ✅ |
| 4 | `ShiftCloseSummaryService` + `ShiftCloseSummaryResponse` (buckets, closed-by) | Opus | `com.crewsafe.shift.summary` ✅ |
| 5 | Shift-scoped CSV writer (reuse `AuditQueryService` writer + self-audit) | Opus | `AuditQueryService.writeShiftCsv` ✅ |
| 6 | `ShiftSummaryController` (2 GETs, authz) | Opus | `ShiftSummaryController.java` ✅ |
| 7 | Backend tests AC1–AC9 | Opus | `ShiftActionsBucketTest` (5) + `ShiftSummaryControllerTest` (11) ✅ |
| 8 | Web API client `fetchShiftSummary` + `downloadShiftSummaryCsv` | Opus (inline) | `web/src/api/shiftSummary.ts` ✅ |
| 9 | `ShiftCloseOutSummary` view + band pill + route + card link | Opus (inline) | `web/src/features/shifts/ShiftCloseOutSummary.{tsx,css}`, `app/App.tsx`, `app/routeAccess.ts`, `features/shifts/ShiftCard.tsx` ✅ |
| 10 | Web tests AC10–AC13 (incl. vitest-axe) | Opus (inline) | `ShiftCloseOutSummary.test.tsx` (5) + `shiftSummary.test.ts` (2) ✅ |

**DONE and GREEN end-to-end** (verification 2026-08-20). The `AuditExportRepository` refactor left
the existing site export byte-identical (its `AuditControllerTest` stays green).

### Verification evidence (backend)
- `ShiftActionsBucketTest` — 5/5 (bucket mapping AC2/AC3).
- `ShiftSummaryControllerTest` — 11/11 (reconciliation anchor + decoy exclusion, peak band + null
  band, closed-by, unclosed-still-summarises, immutability lock-in, CSV + SHA-256, self-audit,
  worker 403, cross-site supervisor 403, 404 body).
- `./mvnw test` — Tests run: 769, Failures: 0, Errors: 0, Skipped: 3.

### Verification evidence (web)
- `ShiftCloseOutSummary.test.tsx` — 5/5 (buckets + peak band + closed-by AC10, "No readings" AC11,
  unclosed line, vitest-axe 0 violations AC13, no-shift empty state).
- `shiftSummary.test.ts` — 2/2 (shift-scoped summary + export URLs AC12).
- `npm run typecheck` clean · `npm run lint` 0 errors · `npx vitest run` — 303 passing (46 files).

### Not yet done (awaiting your go)
- Browser smoke on the Docker/`run.sh` demo env (verification bar step 3): sign in as a SUPERVISOR,
  open a closed shift's summary, confirm totals match the manager audit page, download + verify the
  CSV SHA-256, confirm a WORKER is refused.
- Commit + push + PR against `main` (held — commit only on your say-so).

---

## 7. Per-item verification bar
1. `cd backend && ./mvnw test` (or the project's runner) — new tests green, suite green.
2. `cd web && npm run typecheck && npm run lint && npm run test` — new tests green, suite green.
3. Browser smoke on the Docker/`run.sh` demo env: as a SUPERVISOR on a site, open a closed shift's
   summary, confirm totals match the manager audit page for that shift, download the CSV, verify the
   SHA-256; confirm a WORKER is refused cleanly.
4. vitest-axe 0 violations on the new page.
5. Small commits on `feature/SCRUM-139-close-out-summary` → push → **PR against `main`** → update this
   spec's status + the program plan + baton.

## 8. Out of scope (Phase-2 fast-follows)
- Heat-band timeline / time-in-band roll-up (scope cut 3).
- PDF export (CSV is the acceptance artifact).
- Widening the raw audit timeline to supervisors.
