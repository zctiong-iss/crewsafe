# ADR 0018 — Server-classified WBGT band on the live conditions stream

**Status:** Accepted  
**Date:** 2026-08-17  
**Jira:** SCRUM-318

---

## Context

The supervisor monitoring dashboard (SCRUM-318) turns each Live Board `SiteCard` into a live
tile that must show a WBGT **risk band** (as colour) and a **30-minute forecast**. The live
conditions stream (SCRUM-317/324) carries only raw `wbgt` + freshness — no band, no forecast.

Two mechanisms already exist and are authoritative on the backend:

- `WbgtBand.classify(BigDecimal)` — the server-owned band classifier (half-open 31/32/33). The
  mobile app previously derived bands in a mock layer; that was **deliberately retired**.
- `RecommendationEvidence` already server-classifies `currentBand` and `forecastBand`
  (= `classify(forecastWbgt30m)`), fed by `SiteForecastService`.

The open question was *where* the band gets classified for the live tile, and *how* the forecast
reaches the web — a safety-readout decision, because a band a supervisor trusts and acts on must
not disagree with the policy the site runs under.

## Decision

1. **The band is classified on the server and only rendered on the client.** The stream's
   `ConditionsPayload` gains `currentBand` and `forecastBand` (both via `WbgtBand.classify`), plus
   the raw `forecastWbgt30m`. The web maps `band → colour/label` for display but performs **no**
   `wbgt → band` classification. A null reading yields a null band, never a defaulted `BELOW_31`.

2. **The 30-minute forecast (value + band) rides the existing conditions stream**, sourced from
   `SiteForecastService.forecast(siteId, 30)` inside `ConditionsSnapshotService` — over a separate
   per-card REST fetch. One connection per site, no client-side policy.

3. **Forecast recomputation on every 15s stream tick is accepted for the demo.** The read is
   `@Transactional(readOnly)` and load is small at supervisor scale. A short-TTL cache is deferred
   to production (see Open items).

## Rationale

**Single source of truth for safety policy.** Band thresholds are server-/policy-owned and may
become per-site configurable. A client classifier hard-codes thresholds it cannot know, so it can
silently diverge from the site's actual policy. In a safety readout a confidently-wrong band is
worse than none — the supervisor trusts the colour and stops thinking. Classifying only on the
server removes the divergence entirely; the client renders what the authority decided.

**Rendering the raw forecast value is not classification.** Showing `33.2 °C` beside a
server-decided band chip exposes server-owned data; it does not turn a number into a verdict in
the browser, so it keeps decision 1 intact.

**Stream over REST.** The forecast band changes with the same cadence as conditions and is needed
on the same tile; multiplexing it into the existing snapshot avoids a second auth'd round-trip per
card and keeps each card's lifecycle self-contained.

## Consequences

**Positive:**

- The web can never show a band that disagrees with backend policy — the classifier has exactly
  one home (`WbgtBand`).
- Purely additive on the wire (`currentBand`, `forecastBand`, `forecastWbgt30m`); existing
  consumers ignore the new keys.
- Forecast is **best-effort**: `getSnapshot` catches `ForecastUnavailableException`, so a forecast
  outage (or a site with no usable reading) degrades to "no forecast chip" and never blanks the
  live WBGT / band / lightning readout. The enrichment can fail without failing its host.
- The stream is documented for the first time (`docs/api/conditions-stream.yaml`).

**Open items (carried forward):**

1. **Forecast read-amplification.** Every 15s tick recomputes the 30-min forecast per site per
   viewer. If production profiling shows it bites, add a short-TTL (~5 min) `@Cacheable` on
   `SiteForecastService.forecast`. (Backend — Jemilin.)
2. **Multiplexed stream** for many-site oversight (`/conditions/stream?siteIds=…`) — deferred;
   per-site subscriptions are fine at supervisor scale.
3. **Implementation pending** — this ADR records the decision; the build lands under SCRUM-318.

## Alternatives rejected

1. **Client-side `wbgt → band` classifier.** Rejected on safety grounds (above): duplicated policy
   drifts and a wrong safety colour is worse than none. The retired mobile mock classifier is prior
   art for this rejection.
2. **Per-card REST fetch for the forecast.** Rejected — a second auth'd request per card, an extra
   loading state, and no reuse of the already-open SSE connection.
3. **Band only, forecast value withheld.** Considered (leaner wire) but rejected — the forecast
   number is server-owned data the supervisor benefits from, and showing it does not reintroduce the
   classification risk.

## Related

- ADR-0013 (UTC storage / Singapore display zone — same conditions surface)
- `docs/api/conditions-stream.yaml` (the stream contract, added by SCRUM-318)
- `RecommendationEvidence`, `WbgtBand`, `SiteForecastService` (existing server-side band + forecast)
- SCRUM-317 / SCRUM-324 (the SSE contract + push this builds on)
