# SCRUM-261 — Live lightning in the mobile app, and query-time freshness

SCRUM-170 (#106) added lightning ingestion and per-site risk derivation. SCRUM-111 (#99) made
weather freshness recompute at query time. This ticket is the mobile half of both:

1. A live/simulated toggle on the lightning banner, with the two visually identical.
2. Confirming — and where necessary fixing — the mobile components that SCRUM-111's freshness
   change now drives differently.

---

## What actually landed, verified against `main` (`d50ff2c`)

The PR summaries and the code differ on one point that changes the whole shape of Part 1, so
this section records what is in the repository rather than what was described.

| | |
| --- | --- |
| Lightning ingestion | **Real.** `lightning/` package: NEA client, scheduler, `NearestStrikeSelector`, `LightningRiskDerivationService`, fixture replay |
| Cadence | `LIGHTNING_INGESTION_INTERVAL` default **2m**, opt-in via `LIGHTNING_INGESTION_ENABLED` (default false) |
| Derivation | `stop-work-radius-km` 10, `advisory-radius-km` 20, `validity-window` **30m** |
| States | `CLEAR`, `ADVISORY`, `STOP_WORK` — matches the app's `LightningRiskState` exactly |
| Payload | `LightningRiskPayload(state, nearestStrikeKm, observedAt, validUntil, freshness)` |
| **`GET /api/v1/sites/{siteId}/lightning`** | **Does not exist.** No controller in `lightning/` |
| Where the state *is* published | `ConditionsSnapshot`, carried on `GET /api/v1/sites/{siteId}/conditions/stream` (SSE) |

### Two blockers, both in the transport rather than the data

**1. There is no REST endpoint.** The app's `fetchLightningRisk` is written against
`GET /api/v1/sites/{siteId}/lightning`. That route does not exist on any deployment. The only
carrier of lightning state is an **SSE stream**, which the mobile app has no client for — it
polls, using `useAutoRefresh` at `SHIFT_MS` (60s).

**2. The stream excludes workers.** `SiteConditionsController.stream` is annotated:

```java
@PreAuthorize("hasAnyRole('SUPERVISOR', 'SAFETY_MANAGER', 'ADMIN') and @siteAccess.canAccess(#siteId)")
```

The lightning banner lives on *My shift*, which `RootNavigator` shows to **WORKER only**. So the
one role that needs the banner is the one role forbidden from the only endpoint that carries it.
A worker calling it today gets 403.

**Neither is a mobile bug and neither can be worked around in the app.** A client cannot grant
itself a role, and inferring lightning from anything else is the thing the
[lightning brief](lightning-data-source-brief.md) rules out.

### What this means for sequencing

Part 1 needs one small backend change first. Two options:

**A. Add `GET /api/v1/sites/{siteId}/lightning`** — site-scoped, `@siteAccess.canAccess`, no role
restriction beyond membership. Returns `LightningRiskPayload` plus `siteId`. **Recommended.** It
matches the shape `api/mock/lightning.ts` already commits to, so the mobile change becomes
deleting a branch rather than writing an SSE client; it fits the app's existing polling model;
and it is a read of data a worker is already trusted with — they see the same state in the
banner today.

**B. Widen the SSE stream to include WORKER, and build an SSE client in the app.** More work on
both sides, adds a long-lived connection to a battery-constrained device on an outdoor shift,
and gains nothing at a 2-minute ingestion cadence that a 60-second poll already tracks.

This plan assumes **A**. **Implemented in this branch** — `LightningController`, five endpoint
tests, full backend verify green at 252 — because it blocks everything else and is small.

---

## Part 1 — Live/simulated toggle on the lightning banner

### Outcome

A radio in the *Lightning scenario* dev footer switches the banner between **Live** (the
server's derived state) and **Simulated** (today's `mockLightningRisk` scenarios). The two
render through the same component with the same theme, fonts, colours and layout.

### Scope

`cognito-password` and `cognito-pkce` only. **Not the Demo user route** — `mock` mode never
touches the network, so there is nothing live to switch to, exactly as ruled for SCRUM-209's
weather work.

### The rule that matters

**Live must never invent a state.** If the server has no lightning observation for the site, or
the ingestion is disabled, or the request fails, the banner must say so — it must **not** fall
back to `CLEAR`. "No data" and "no lightning" are the same pixels and opposite meanings on a
stop-work surface.

That gives Live four outcomes:

| Server says | Banner |
| --- | --- |
| `CLEAR` / `ADVISORY` / `STOP_WORK`, `validUntil` in future | that state, as today |
| a state whose `validUntil` has passed | the existing expired treatment, unchanged |
| 404 — nothing ingested for this site | **new** unavailable state |
| 403 / network failure | the screen's existing error path |

The unavailable state is new copy and needs all seven locales.

### Presentation does not change

The requirement is explicit: same themes, fonts, background colours. `LightningBanner` is not
touched except to accept the new unavailable state. Live and Simulated differ in **where the
data came from and what the freshness marker says**, nothing else.

`LightningRiskPayload` carries `freshness`, which the app's `LightningRisk` type does not have.
Adding it lets the banner mark a live-but-stale assessment honestly, using the `FreshnessBadge`
that already exists — and it is what keeps Simulated visibly `SIMULATED`.

### Toggle mechanics

Follows the existing dev-footer pattern (`getLightningScenario` / `setLightningScenario` in
`api/mock/scenario.ts`): a module variable, a radio group, `__DEV__ && !isMockApi()` gating.
The scenario radios stay, and are disabled while Live is selected — a simulated scenario has no
meaning against a live feed, and leaving them tappable invites the exact confusion of thinking
you have changed something live.

### Risks

**A worker trusting a demo.** The toggle is dev-only and compiled out of release, the same fence
`SignInScreen`'s mode picker sits behind. Worth stating because this toggle changes a stop-work
banner rather than a label.

**403 read as "clear".** Covered by the rule above; must be tested explicitly.

---

## Part 2 — SCRUM-111 query-time freshness

### What changed server-side

`WeatherQueryService` now recomputes `qualityStatus` on every read, and preserves `SIMULATED`
for fixture rows regardless of age. So the **same stored observation now returns a different
freshness over time** — `LIVE`, then `DELAYED`, then `STALE` — with no new ingestion.

### What the mobile app already gets right

`WbgtCard`, `FreshnessBadge`, `FreshnessNotice` and the Weather hero all render
`conditions.qualityStatus` straight from the response and derive nothing locally. That is
correct by construction and needs no change — which is the finding, and it should be recorded
rather than assumed.

### What actually needs looking at

**Poll cadence versus freshness thresholds.** The app polls weather every `WEATHER_MS` (5
minutes), with the comment *"`WEATHER_INGESTION_INTERVAL` defaults to 15m; a third of that
bounds staleness."* That reasoning was written when freshness was fixed at ingestion. Now that
it moves on its own, the badge can lag reality by up to one poll interval: a reading can be
`STALE` server-side while the app still shows the `LIVE` it fetched four minutes ago.

Whether that matters depends on the configured thresholds, which is the first task — measure
before changing the interval. Shortening the poll costs battery on an outdoor shift and should
not be done reflexively.

**Nothing recomputes freshness client-side, and nothing should.** Same reasoning as the WBGT
band: the server owns it. If the lag is judged unacceptable, the fix is a shorter poll, not a
client-side classifier.

---

## Acceptance

**Part 1**

- Live selected: the banner renders the server's derived state, and the same state is visible
  in the backend response for that site.
- Live with no observation: the unavailable state renders. **Not** `CLEAR`.
- Live with an expired `validUntil`: the existing expired treatment, unchanged.
- Simulated: byte-identical behaviour to today, including all three scenarios.
- Live and Simulated banners are visually identical for the same state — verified by
  screenshot comparison, not by inspection of the code.
- The toggle is absent in a release bundle and in `mock` auth mode.
- Scenario radios are disabled while Live is selected.
- Seven locales for the unavailable copy; `check:locales` passes.

**Part 2**

- The observed freshness thresholds are recorded in the plan or README, with the poll interval
  justified against them.
- A stale-server reading is shown as stale by the app within one poll interval, verified on
  device by holding the ingestion off.
- No client-side freshness derivation is introduced.

---

## Out of scope

**An SSE client for the mobile app.** Option B above. If the supervisor screens later need
push-rate conditions, that is its own ticket with its own battery argument.

**Live lightning in the Demo user route.** `mock` mode has no network by design.

**Changing the derivation radii or validity window.** `stop-work-radius-km`, `advisory-radius-km`
and `validity-window` are backend configuration and belong to SCRUM-170.
