# SCRUM-114 / US-06 — 30- and 60-minute WBGT forecast on mobile

**Scope: React Native only.** The React web frontend is not touched.

**Branch:** `feat/scrum-114-mobile-wbgt-forecast`, cut from `origin/main` after PR #222.

@author Justin Chua

---

## What is already on main

PR #222 landed the backend door (SCRUM-281), and PR #224 landed the untouched-model
approval evaluator. Verified against `origin/main`:

| Piece | State |
| --- | --- |
| `ml-service/crewsafe_ml/` training, inference, backtesting | on main |
| `backend/.../forecast/` — 6 main classes, 4 test classes | on main (PR #222) |
| `GET /api/v1/sites/{siteId}/weather/forecast` | on main, site-authorized |
| `ml-service/crewsafe_ml/approval_evaluation.py` | on main (PR #224) |
| Anything on mobile | **nothing** |

The contract:

```
GET /api/v1/sites/{siteId}/weather/forecast?horizonMinutes=30|60
→ SiteForecast { metric, predictedValue, horizonMinutes, modelVersion,
                 confidenceIntervalLower, confidenceIntervalUpper, generatedAt }
```

`horizonMinutes` other than 30 or 60 is a 400. The FastAPI service stays private —
clients never receive its address or the model bundle.

---

## The two findings that shape the design

### 1. "Unavailable" is the common case, not the error case

`SiteForecastService` refuses to guess. It throws `ForecastUnavailableException` → **503**
on seven separate paths:

- no recent weather rows for the site
- the latest row has no WBGT
- fewer than two rows
- the latest row has no station id
- quality is `SIMULATED`, or the classifier says `STALE`
- station identity changed inside the 2-hour window
- any spacing off the exact 15-minute cadence

That strictness is right — a model fed stale or simulated input would produce a confident
number about nothing. But it means 503 is *routine*: a quiet site, a demo build, or one
missed ingestion tick all produce it. Rendering it as an error would put a red banner over
a conditions screen that is working perfectly, and teach supervisors to ignore banners.

So the slice carries **`unavailable` as a distinct status**, and the screen renders it as a
quiet explanation of why the model is declining — not as a failure.

### 2. Mobile cannot show a forecast *band*, and should not fake one

`SiteForecast` returns `predictedValue` but **no band**. FR-15 and §12.2 forbid the client
deriving one; `weatherSlice` already documents that the observed band "arrives evaluated;
the client does not compute it."

Separately, `PolicyEngineService` on main still sets `forecastBand = currentBand` behind a
TODO — so no evaluated forecast band exists anywhere in the system yet.

Deriving Green/Amber/Red on the device would be the single most damaging shortcut available
here: a client-side threshold silently diverges the moment a Safety Manager versions the
policy (SCRUM-120), and the screen would keep showing the old band with total confidence.

**Therefore this plan ships degrees and interval, not a band**, and raises the backend work
as its own ticket. That is the honest rendering, not a degraded one.

---

## Design

**`ForecastScreen`** — both horizons, each showing:

- predicted WBGT in °C
- the confidence interval as a **range**, always visible beside the point estimate
- provenance: `modelVersion` and `generatedAt`

A forecast must never be mistakable for a measurement, so it is separated from the observed
reading by label, by tense, and by always carrying its interval. A point estimate with the
uncertainty hidden is exactly the failure this screen exists to avoid; a wide interval is
shown as wide.

**Entry point on `WeatherScreen`** — a compact card below the hero with the 30-minute
prediction, routing into `ForecastScreen`. It sits visually subordinate to the hero: the
*measured* reading stays the primary number there. Under `unavailable` the card collapses to
one explanatory line and nothing else on the screen changes.

`WeatherScreen` is the right host because it already owns site selection, freshness and
auto-refresh, and is where a supervisor already looks — a new tab would split one question
across two places.

---

## Subtasks

1. Extend the mobile forecast contract and mock fixtures
2. Add the forecast slice with `unavailable` as a first-class state
3. Build `ForecastScreen` for 30 and 60 minutes
4. Add the forecast entry point to `WeatherScreen`
5. Ship the forecast strings across all seven locales
6. Tests and the full mobile gate
7. **Backend follow-up** — return the evaluated band with the forecast, and wire
   `PolicyEngineService` to the real forecast

---

## Notes carried in from earlier work

- **Numeric wire fields are numbers.** SCRUM-120 opened a blank create form because
  thresholds were typed as `string` while the server sent JSON numbers, and the mock
  repeated the mistake so every test agreed with the mock and disagreed with the server.
  `predictedValue` and both interval bounds are typed `number`.
- **Locale parity** needs both plural forms for every counted key, including in languages
  that do not inflect.
- `horizonMinutes` is a `30 | 60` union, so an invalid horizon fails at compile time rather
  than as a 400 at runtime.
