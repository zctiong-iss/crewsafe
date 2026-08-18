# ADR 0020 — Action response-time from audit-event correlation

**Status:** Accepted
**Date:** 2026-08-18
**Jira:** SCRUM-433

---

## Context

SCRUM-433's compliance dashboard reports how quickly workers acknowledge dispatched safety
actions: a p50/p95 response time and a latency histogram, over a site and time window.

The counts half of the report comes straight off `ActionDispatch` (status, `completedBy`,
`dispatchedAt`) — that data is in-row. The **response time** does not: it is
`acknowledgedAt − dispatchedAt`, and **`ActionDispatch` records no `acknowledgedAt`**. When a
dispatch is acknowledged its `status` flips to `ACKNOWLEDGED`, but the *timestamp* of that flip
is never stored on the row. The only place the acknowledgement time exists is the
`ACTION_ACKNOWLEDGED` audit event (`audit_event.occurred_at`), written at ack time with the
dispatch id as its target.

## Decision

Compute response time by **correlating the `ACTION_ACKNOWLEDGED` audit event back to its
dispatch**, rather than adding an `acknowledgedAt` column to `ActionDispatch`:

```sql
EXTRACT(EPOCH FROM (MIN(ae.occurred_at) - ad.dispatched_at))
  ... JOIN audit_event ae
        ON ae.target_type = 'ACTION_DISPATCH'
       AND ae.target_id   = ad.id
       AND ae.event_type  = 'ACTION_ACKNOWLEDGED'
  GROUP BY ad.id, ad.dispatched_at
```

`MIN(occurred_at)` takes the first acknowledgement as the response. The query lives in the
insights feature's own repository (`ComplianceQueryRepository`), reaching a site through the
same `recommendation → shift.site_id` theta-join the counts use — so it adds no method to a
teammate's `ActionDispatchRepository`.

The frontend contract already tolerates the absence of data: `p50/p95` are nullable and the
histogram bands are emitted empty, so a window with no acknowledgements reads as "no response
times yet", not an error.

## Rationale

**Why not add `acknowledgedAt` to `ActionDispatch`.** It is the cleaner long-term shape, but for
this ticket it was rejected:

1. **Not additive.** `ActionDispatch` and its write path (`ActionDispatchService`, the ack-window
   sweep) are teammate-owned (Surya / Jemilin). Adding and populating a column means a migration
   plus changes to their acknowledge and auto-complete paths — outside this ticket's boundary,
   and the Session-2 constraint was explicitly *no teammate file changes*.
2. **The data already exists, losslessly.** `ACTION_ACKNOWLEDGED` is written at the moment of
   acknowledgement with the dispatch as its target. The ack time is not being reconstructed or
   approximated — it is read from the one authoritative record of when the ack happened.
3. **This is a read-time analytics need.** The dashboard is a bounded report, not a hot path.
   Correlating on read is cheap enough and keeps the write path untouched.

**Why `MIN`.** A dispatch should carry exactly one `ACTION_ACKNOWLEDGED`, but `MIN` makes the
query robust to a duplicate: the *first* acknowledgement is, by definition, the response time.

## Consequences

**Positive:**
- No `ActionDispatch` schema change, no teammate write-path change.
- Response time comes from the authoritative ack record, not a second column that could drift
  out of sync with the audit trail.
- Degrades cleanly: no acks in range → null percentiles + empty (but present) histogram bands.

**Negative / carried forward:**
1. **Response time depends on the audit event being written.** If an acknowledgement ever failed
   to record its `ACTION_ACKNOWLEDGED` event, that dispatch would be absent from the histogram
   (though still counted as `actedOn`). Acceptable: the same event is the system's own record of
   the ack, so its absence would be a broader integrity problem than this report.
2. **If response time becomes a hot, frequently-read metric,** revisit and denormalise
   `acknowledgedAt` onto `ActionDispatch` (coordinated with its owners) — the correlation join is
   a read-time cost.

## Alternatives rejected

1. **Add `acknowledgedAt` to `ActionDispatch`.** The clean long-term model, deferred here on the
   additive-only constraint. The right move *if* the metric turns hot or the owners are changing
   that write path anyway.
2. **Ship compliance counts and defer the histogram entirely.** Considered — the contract
   tolerates null p50/p95. Rejected because the ack data is already present and the correlation
   join is straightforward, so the fuller dashboard was worth building now (decision confirmed
   with the ticket owner).
3. **Approximate response time from `start_time` / `end_time` on the dispatch.** Rejected — those
   describe the action's own execution window, not when the worker acknowledged it; they answer a
   different question.

---

## Related

- ADR-0013 (UTC storage / Singapore display zone — compliance days are bucketed in the site's
  timezone, not UTC)
- ADR-0019 (audit-event target resolution — the same `(target_type, target_id)` correlation idiom)
- SCRUM-324 (the ack-window / auto-complete sweep that owns `ActionDispatch` status transitions)
