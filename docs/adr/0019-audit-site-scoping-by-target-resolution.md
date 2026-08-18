# ADR 0019 — Audit trail site-scoping by query-time target resolution

**Status:** Accepted
**Date:** 2026-08-18
**Jira:** SCRUM-435

---

## Context

SCRUM-435 adds an inspector-facing audit trail per site: `GET /api/v1/sites/{siteId}/audit`
(paged) and `/audit/export.csv`. Both must return exactly the events that belong to a site and
nothing from any other site — an audit export that leaks another site's history, or silently
drops rows that belong in this one, is a compliance failure, not a cosmetic bug.

But `audit_event` has **no `site_id` column**, by original design (ADR-era SCRUM-183): a row
names *what* it happened to as a `(target_type, target_id)` pair, not *where*. Those target
types reach a site by different routes:

| `target_type` | reaches a site via |
|---|---|
| `SHIFT` | `shift.site_id` |
| `RECOMMENDATION`, `ACTION_DISPATCH` | recommendation → `shift.site_id` (dispatch via `recommendation_id`) |
| `READINESS_SUBMISSION`, `WELLBEING_LOG`, `CONCERN` | the row's own `shift_id` → `shift.site_id` |
| `POLICY_VERSION` | `policy_version.site_id` (directly) |
| `SITE` | the target **is** the site |
| `USER` (e.g. `TOKEN_FIRST_SEEN`) | **no site** — an identity event |

## Decision

Resolve a row's **effective site at query time**, in a single native query, via `LEFT JOIN`s
across the target chains and a `COALESCE` that picks the first route that resolves:

```
:siteId = COALESCE(shift.site_id, policy_version.site_id,
                   CASE WHEN target_type = 'SITE' THEN target_id END)
```

A `USER`-scoped event resolves to `NULL` on every arm, so `:siteId = NULL` is UNKNOWN and the
row is **excluded from every site's export**. The identical FROM/WHERE block backs the page
query, its count, and the CSV export, so all three scope a site the same way — a row on screen
is a row in the file.

`audit_event` is left **exactly as it is**: no new column, no write-path change.

## Rationale

**Why not denormalise `audit_event.site_id`.** The obvious alternative — stamp a `site_id` on
each row at write time — would make this query trivial and fast. It was rejected for this cut on
three grounds:

1. **It is not additive.** It changes `AuditService.record(...)` and every one of its ~15 call
   sites across five teammates' modules (shift, operation, wellbeing, policy, identity), plus a
   backfill migration over an **append-only** table whose own trigger forbids `UPDATE`. That is a
   cross-cutting change to code this ticket does not own.
2. **The write path does not always know the site cheaply.** Several callers hold only the
   target id at audit time; they would each need an extra lookup to stamp the site, pushing the
   same resolution work onto every writer instead of doing it once on the rare read.
3. **Reads are rare and bounded.** The audit trail is an inspector surface over a date window,
   not a hot path. Paying the join cost on read, occasionally, is cheaper overall than a column
   every writer must maintain forever.

**Why excluding `USER`-scoped events is correct, not a gap.** `TOKEN_FIRST_SEEN` records that a
token was seen — an identity fact with no site. It has no natural home in any *site's* trail, so
resolving it to "no site" and omitting it is the right answer, not a dropped row.

## Consequences

**Positive:**
- No teammate file changes; `audit_event` stays append-only and untouched.
- One resolution rule, in one place, shared by page + count + export — they cannot disagree.
- Correctly excludes cross-site and site-less rows (proven by integration test: another site's
  event never appears; a no-actor system event still resolves through its target).

**Negative / carried forward:**
1. **The query couples the audit read to six target-bearing tables.** A new site-bound
   `target_type` means adding a join arm here. Acceptable while the target vocabulary is small
   and changes rarely; revisit (denormalise) if it grows or the read becomes hot.
2. **Interface-projection column aliases** rely on Spring's case-insensitive mapping over
   Postgres-lowercased labels — verified working by the integration test, but a constraint to
   keep in mind if the projection is refactored.

## Alternatives rejected

1. **Denormalise `audit_event.site_id` (stamp at write time + backfill).** Rejected for this
   ticket — not additive, touches every writer + a migration on an append-only table. The
   natural long-term answer *if* target types multiply or the read turns hot; explicitly
   deferred, not dismissed.
2. **Resolve site in Java (N queries per row).** Rejected — a page of 50 rows would fan out into
   dozens of lookups; the set-based join does it in one.
3. **Restrict the export to `SHIFT`-target events only.** Rejected — it would silently omit
   policy, wellbeing, concern, and site-level events that genuinely belong in a site's trail.

---

## Related

- ADR-0013 (UTC storage / Singapore display zone — audit timestamps exported as ISO instants)
- SCRUM-183 (append-only `audit_event`, the reason there is no `site_id` to begin with)
- Commit `56cb70f` (CSV formula-injection guard on the same export — security-review MEDIUM)
